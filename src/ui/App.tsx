// Screens: home, a game against the computer, an online room, and stats.

import { useCallback, useEffect, useState } from 'react';
import { auth } from '../firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import type { GameState } from '../engine/types';
import { createGame, PLAYER_COLORS } from '../engine/game';
import { totalVP } from '../engine/rules';
import { Home, type SoloOptions } from './Home';
import { GameScreen } from './GameScreen';
import { Lobby } from './Lobby';
import { SOLO_SAVE, useLocalGame, useOnlineGame } from './useGame';
import { createRoom, forgetRoom, joinRoom, leaveRoom, rememberedRoom, useRoom } from '../net/rooms';
import ProfilePage from '../ProfilePage';
import { extractGameStats } from '../stats/extractGameStats';
import { recordGameAndUpdateStats } from '../stats/statsService';
import { handoverReason, useHandover } from './hotseat';
import { Curtain } from './Curtain';

const AI_NAMES = ['Hildeguard', 'Steve', 'Tammy', 'Oswin', 'Marigold'];
const SPEED_KEY = 'catan2_speed';

type Screen =
  | { kind: 'home' }
  | { kind: 'solo'; state: GameState; me: number; opts?: SoloOptions }
  | { kind: 'room'; roomId: string; slot: number }
  | { kind: 'profile' };

function loadSave(): GameState | null {
  try {
    const s = JSON.parse(localStorage.getItem(SOLO_SAVE) ?? 'null');
    return s && s.schema === 2 && s.phase !== 'gameOver' ? s : null;
  } catch { return null; }
}

// Options for "Play again" after a resumed game, read back from the save.
function savedOptions(s: GameState): SoloOptions {
  let level: SoloOptions['level'] = 'normal';
  const ai = s.players.find((p) => p.controller === 'ai');
  if (ai) level = ai.aiLevel;
  const color = Math.max(0, PLAYER_COLORS.indexOf(s.players[0].color));
  const people = s.players.slice(1).filter((p) => p.controller === 'human').map((p) => p.name);
  return { name: s.players[0].name, people, opponents: s.players.length - 1 - people.length, level, vpToWin: s.config.vpToWin, friendlyRobber: s.config.friendlyRobber, color };
}

function newSolo(o: SoloOptions): GameState {
  const others = PLAYER_COLORS.slice(0, 4).filter((_, i) => i !== o.color);
  const people = (o.people ?? []).slice(0, 3);
  const taken = [o.name, ...people].map((n) => n.trim().toLowerCase());
  return createGame({
    players: [
      { name: o.name, controller: 'human', color: PLAYER_COLORS[o.color] },
      ...people.map((name, i) => ({ name, controller: 'human' as const, color: others[i] })),
      // Computers never share your name, so the log stays readable.
      ...AI_NAMES.filter((n) => !taken.includes(n.toLowerCase())).slice(0, Math.min(o.opponents, 3 - people.length))
        .map((name, i) => ({ name, controller: 'ai' as const, aiLevel: o.level, color: others[people.length + i] })),
    ],
    vpToWin: o.vpToWin,
    friendlyRobber: o.friendlyRobber,
  });
}

function useUser() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  return user;
}

async function recordStats(user: User | null, s: GameState, me: number, solo: boolean) {
  if (!user || user.isAnonymous) return;
  try {
    await recordGameAndUpdateStats(user.uid, user.displayName ?? 'Player', user.photoURL, extractGameStats(s, me, solo));
  } catch (e) {
    console.warn('Could not save stats', e);
  }
}

function SoloGame({ screen, onExit, onNew, speed, setSpeed, user }: {
  screen: Extract<Screen, { kind: 'solo' }>; onExit(): void; onNew?: () => void; speed: number; setSpeed(n: number): void; user: User | null;
}) {
  const game = useLocalGame(screen.state, screen.me, speed);
  // Pass and play: with several people at one screen, show whoever must act.
  const shared = screen.state.players.filter((p) => p.controller === 'human').length > 1;
  const hand = useHandover(game.state, shared);
  const me = hand.seat ?? game.me;
  const onFinished = useCallback((s: GameState) => { void recordStats(user, s, screen.me, true); }, [user, screen.me]);
  return (
    <>
      <GameScreen game={{ ...game, me }} onExit={onExit} onNewGame={onNew} onFinished={onFinished} speed={speed} setSpeed={setSpeed} />
      {hand.curtain && game.state && hand.seat !== null && (
        <Curtain name={game.state.players[hand.seat].name} color={game.state.players[hand.seat].color}
          reason={handoverReason(game.state, hand.seat)} onReveal={hand.reveal} />
      )}
    </>
  );
}

function RoomScreen({ roomId, slot, onExit, speed, setSpeed, user }: { roomId: string; slot: number; onExit(): void; speed: number; setSpeed(n: number): void; user: User | null }) {
  const { room, error } = useRoom(roomId);
  const leave = useCallback(() => { void leaveRoom(roomId, slot); onExit(); }, [roomId, slot, onExit]);
  if (error) return <div className="center-msg">{error}<button type="button" className="btn" onClick={() => { forgetRoom(); onExit(); }}>Back</button></div>;
  if (!room) return <div className="center-msg">Opening room {roomId}…</div>;
  if (room.status === 'waiting' || !room.gameState) return <Lobby room={room} me={slot} onLeave={leave} />;
  return <OnlineGame roomId={roomId} slot={slot} onExit={leave} speed={speed} setSpeed={setSpeed} user={user} />;
}

function OnlineGame({ roomId, slot, onExit, speed, setSpeed, user }: { roomId: string; slot: number; onExit(): void; speed: number; setSpeed(n: number): void; user: User | null }) {
  const game = useOnlineGame(roomId, slot, speed);
  const onFinished = useCallback((s: GameState) => { void recordStats(user, s, slot, false); }, [user, slot]);
  return <GameScreen game={game} onExit={onExit} onFinished={onFinished} speed={speed} setSpeed={setSpeed} inviteCode={roomId} />;
}

export default function App() {
  const user = useUser();
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [save, setSave] = useState(loadSave);
  const [speed, setSpeedState] = useState(() => Number(localStorage.getItem(SPEED_KEY)) || 1);
  const setSpeed = (n: number) => { setSpeedState(n); localStorage.setItem(SPEED_KEY, String(n)); };
  const [initialCode] = useState(() => new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? null);
  const rejoin = rememberedRoom();

  const home = useCallback(() => { setSave(loadSave()); setScreen({ kind: 'home' }); }, []);

  const clearRoomParam = () => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('room')) { url.searchParams.delete('room'); window.history.replaceState({}, '', url.toString()); }
  };

  if (screen.kind === 'solo') {
    return (
      <SoloGame key={screen.state.id} screen={screen} onExit={home} speed={speed} setSpeed={setSpeed} user={user}
        onNew={screen.opts ? () => setScreen({ kind: 'solo', state: newSolo(screen.opts!), me: 0, opts: screen.opts }) : undefined} />
    );
  }
  if (screen.kind === 'room') return <RoomScreen key={screen.roomId} roomId={screen.roomId} slot={screen.slot} onExit={home} speed={speed} setSpeed={setSpeed} user={user} />;
  if (screen.kind === 'profile' && user) {
    return <ProfilePage uid={user.uid} displayName={user.displayName ?? 'Player'} photoURL={user.photoURL} onBack={home} />;
  }

  return (
    <Home
      hasSave={!!save}
      savedSummary={save ? `turn ${save.turn}, ${totalVP(save, 0)} points` : null}
      onSolo={(o) => { localStorage.removeItem(SOLO_SAVE); setScreen({ kind: 'solo', state: newSolo(o), me: 0, opts: o }); }}
      onResume={() => save && setScreen({ kind: 'solo', state: save, me: 0, opts: savedOptions(save) })}
      onDiscardSave={() => { localStorage.removeItem(SOLO_SAVE); setSave(null); }}
      onCreate={async (name) => {
        try {
          const id = await createRoom(name);
          setScreen({ kind: 'room', roomId: id, slot: 0 });
          return null;
        } catch {
          return 'Couldn\'t create a room. Check your connection.';
        }
      }}
      onJoin={async (code, name) => {
        const r = await joinRoom(code, name);
        if ('error' in r) return r.error;
        clearRoomParam();
        setScreen({ kind: 'room', roomId: code, slot: r.slot });
        return null;
      }}
      onProfile={() => setScreen({ kind: 'profile' })}
      rejoin={rejoin}
      onRejoin={() => rejoin && setScreen({ kind: 'room', roomId: rejoin.roomId, slot: rejoin.slot })}
      initialCode={initialCode}
    />
  );
}
