// The table: board in the middle, players and log at the sides, your hand and
// actions along the bottom. Turns game events into sounds and animations.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, DevKind, GameEvent, GameState, PartialHand, Resource } from '../engine/types';
import { DEV_NAMES, waitingOn } from '../engine/game';
import {
  COST, canAfford, citySpots, piecesLeft, playableDev, roadSpots, robberSpots, settlementSpots,
  setupRoadSpots, stealTargets, type Buildable,
} from '../engine/rules';
import { Board, type BoardApi, type Pick } from './Board';
import { Dice } from './Dice';
import { BankView, BuildMenu, DevHand, GameLog, HandView, PlayerList } from './Panels';
import {
  DiscardDialog, GameOverDialog, IncomingOffer, MonopolyDialog, RulesDialog, SettingsDialog, StealDialog,
  TradeDialog, YearOfPlentyDialog,
} from './Dialogs';
import { Confetti, FlyLayer, type FlyApi } from './effects';
import { ResourceIcon } from './art';
import { sound } from '../audio/sound';
import type { GameController } from './useGame';

interface Toast { id: number; text: string; color?: string; bad?: boolean }

interface Props {
  game: GameController;
  onExit(): void;
  onNewGame?: () => void;
  onFinished?: (s: GameState) => void;
  speed: number;
  setSpeed(n: number): void;
  inviteCode?: string;
}

export function GameScreen({ game, onExit, onNewGame, onFinished, speed, setSpeed, inviteCode }: Props) {
  const { state, me, dispatch } = game;
  const board = useRef<BoardApi>(null);
  const fly = useRef<FlyApi>(null);
  const [rawMode, setMode] = useState<Buildable | null>(null);
  // Build mode only means something on your own turn after rolling.
  const mode = state && state.phase === 'main' && state.current === me ? rawMode : null;
  const [dialog, setDialog] = useState<null | 'trade' | 'rules' | 'settings' | 'yop' | 'monopoly' | 'gameover' | 'log'>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dice, setDice] = useState<{ a: number; b: number; key: number }>({ a: 3, b: 4, key: 0 });
  const [lit, setLit] = useState<number | null>(null);
  const [confetti, setConfetti] = useState(0);
  const [muted, setMuted] = useState(sound.sfxVolume === 0);
  const lastSeq = useRef<number | null>(null);
  const toastId = useRef(1);

  const toast = useCallback((text: string, opts: { color?: string; bad?: boolean } = {}) => {
    const id = toastId.current++;
    setToasts((t) => [...t.slice(-3), { id, text, ...opts }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.bad ? 3200 : 3800);
  }, []);

  const act = useCallback(async (a: Action) => {
    sound.unlock();
    const err = await dispatch(a);
    if (err) {
      sound.play('error');
      toast(err, { bad: true });
    }
    return err;
  }, [dispatch, toast]);

  // Test hook: ?debug exposes the game to the browser console and to scripts.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('debug')) return;
    (window as unknown as { __game: unknown }).__game = { state, me, dispatch };
  }, [state, me, dispatch]);

  // ── events → sound and motion ────────────────────────────────────────────
  useEffect(() => {
    if (!state) return;
    if (lastSeq.current === null) { lastSeq.current = state.seq; return; }
    const fresh = state.events.filter((e) => e.seq > lastSeq.current!);
    lastSeq.current = state.seq;
    let rolledAt = 0;
    for (const e of fresh) handle(e);

    function playerTarget(p: number, res?: Resource) {
      const sel = p === me && res ? `[data-res="${res}"]` : `[data-seat="${p}"]`;
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    function handle(e: GameEvent) {
      const s = state!;
      switch (e.kind) {
        case 'roll': {
          rolledAt = 800;
          setDice((d) => ({ a: e.a, b: e.b, key: d.key + 1 }));
          sound.play('dice');
          const sum = e.a + e.b;
          setTimeout(() => {
            setLit(sum);
            if (sum === 7) { sound.play('seven'); toast('Seven! The robber wakes up.', { color: '#2b2a2e' }); }
          }, 760);
          setTimeout(() => setLit(null), 3200);
          break;
        }
        case 'produce': {
          let mine = 0;
          e.gains.forEach((g, i) => {
            if (g.player === me) mine += g.n;
            const from = board.current?.hexPoint(g.hex);
            const to = playerTarget(g.player, g.res);
            if (!from || !to) return;
            for (let k = 0; k < g.n; k++) {
              fly.current?.fly(from, to, <div className="fly-card"><ResourceIcon res={g.res} size={26} /></div>, rolledAt + i * 90 + k * 140, 1000);
            }
          });
          setTimeout(() => {
            if (mine) sound.play('gain', { count: mine });
            else sound.play('card');
          }, rolledAt + 450);
          break;
        }
        case 'build':
          sound.play(e.what === 'road' ? 'road' : e.what === 'city' ? 'city' : 'build');
          break;
        case 'robber':
          sound.play('robber');
          break;
        case 'steal': {
          sound.play('steal');
          const from = playerTarget(e.victim), to = playerTarget(e.thief);
          if (from && to) fly.current?.fly(from, to, <div className="fly-card back" />, 200, 900);
          if (e.thief === me && e.res) toast(`You stole ${RES_NAME[e.res]} from ${s.players[e.victim].name}.`, { color: s.players[me].color });
          else if (e.victim === me) toast(`${s.players[e.thief].name} stole ${e.res ? RES_NAME[e.res] : 'a card'} from you.`, { color: s.players[e.thief].color });
          break;
        }
        case 'discard':
          sound.play('discard');
          break;
        case 'devBuy':
          sound.play('card');
          if (e.player === me) toast('You bought a development card.', { color: s.players[me].color });
          break;
        case 'devPlay':
          sound.play('card');
          if (e.player !== me) toast(`${s.players[e.player].name} plays ${DEV_NAMES[e.card]}.`, { color: s.players[e.player].color });
          break;
        case 'trade':
          sound.play('trade');
          break;
        case 'award':
          sound.play('award');
          if (e.player !== null) toast(`${s.players[e.player].name} takes ${e.award === 'longestRoad' ? 'Longest Road' : 'Largest Army'}!`, { color: s.players[e.player].color });
          break;
        case 'turn':
          if (e.player === me) {
            setTimeout(() => sound.play('turn'), 150);
          }
          break;
        case 'win':
          if (e.player === me) { sound.play('win'); setConfetti((c) => c + 1); } else sound.play('lose');
          setTimeout(() => setDialog('gameover'), 1600);
          onFinished?.(s);
          break;
      }
    }
  }, [state, me, toast, onFinished]);


  // ── what can I click? ────────────────────────────────────────────────────
  const pick: Pick = useMemo(() => {
    if (!state || state.current !== me) return null;
    switch (state.phase) {
      case 'setup':
        return state.setup!.step === 'settlement'
          ? { kind: 'vertex', ids: settlementSpots(state, me, true), piece: 'settlement' }
          : { kind: 'edge', ids: setupRoadSpots(state, me) };
      case 'robber': return { kind: 'hex', ids: robberSpots(state, me) };
      case 'roadBuilding': return { kind: 'edge', ids: roadSpots(state, me) };
      case 'main':
        if (mode === 'road') return { kind: 'edge', ids: roadSpots(state, me) };
        if (mode === 'settlement') return { kind: 'vertex', ids: settlementSpots(state, me), piece: 'settlement' };
        if (mode === 'city') return { kind: 'vertex', ids: citySpots(state, me), piece: 'city' };
        return null;
      default: return null;
    }
  }, [state, me, mode]);

  const onVertex = (v: string) => {
    if (!state) return;
    if (state.phase === 'setup') void act({ type: 'placeSettlement', player: me, vertex: v });
    else if (mode === 'settlement') void act({ type: 'buildSettlement', player: me, vertex: v }).then((e) => { if (!e) setMode(null); });
    else if (mode === 'city') void act({ type: 'buildCity', player: me, vertex: v }).then((e) => { if (!e) setMode(null); });
  };
  const onEdge = (e: string) => {
    if (!state) return;
    if (state.phase === 'setup') void act({ type: 'placeRoad', player: me, edge: e });
    else if (state.phase === 'roadBuilding' || mode === 'road') {
      void act({ type: 'buildRoad', player: me, edge: e }).then((err) => {
        // Keep road mode on while there's money for another.
        if (!err && state.phase === 'main' && !canAfford({ ...state.players[me].hand, wood: state.players[me].hand.wood - 1, brick: state.players[me].hand.brick - 1 }, COST.road)) setMode(null);
      });
    }
  };
  const onHex = (h: number) => { void act({ type: 'moveRobber', player: me, hex: h }); };

  // Keyboard: R roll, E end turn, T trade, Esc cancel.
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if (!state || dialog || (ev.target as HTMLElement)?.tagName === 'INPUT') return;
      const myTurn = state.current === me;
      if (ev.key === 'Escape') setMode(null);
      if (!myTurn) return;
      if ((ev.key === 'r' || ev.key === ' ') && state.phase === 'roll') { ev.preventDefault(); void act({ type: 'roll', player: me }); }
      if (ev.key === 'e' && state.phase === 'main' && !state.trade) void act({ type: 'endTurn', player: me });
      if (ev.key === 't' && state.phase === 'main') setDialog('trade');
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [state, me, dialog, act]);

  if (!state) {
    return <div className="center-msg">{game.error ?? 'Connecting to the game…'}</div>;
  }

  const meP = state.players[me];
  const myTurn = state.current === me;
  const waiting = waitingOn(state);
  const playable = playableDev(state, me);
  const left = piecesLeft(state, me);
  const mainMine = myTurn && state.phase === 'main';
  const reasons: Record<Buildable, string | null> = {
    road: !mainMine ? 'Build on your turn after rolling' : !canAfford(meP.hand, COST.road) ? 'Needs 1 lumber and 1 brick' : left.road <= 0 ? 'No roads left' : !roadSpots(state, me).length ? 'Nowhere to build a road' : null,
    settlement: !mainMine ? 'Build on your turn after rolling' : !canAfford(meP.hand, COST.settlement) ? 'Needs lumber, brick, wool and grain' : left.settlement <= 0 ? 'No settlements left' : !settlementSpots(state, me).length ? 'No open spot on your roads. Build roads first.' : null,
    city: !mainMine ? 'Build on your turn after rolling' : !canAfford(meP.hand, COST.city) ? 'Needs 2 grain and 3 ore' : left.city <= 0 ? 'No cities left' : !citySpots(state, me).length ? 'Upgrade one of your settlements' : null,
    dev: !mainMine ? 'Buy on your turn after rolling' : !canAfford(meP.hand, COST.dev) ? 'Needs wool, grain and ore' : !state.devDeck.length ? 'The deck is empty' : null,
  };
  const onBuild = (b: Buildable) => {
    sound.unlock();
    if (b === 'dev') { void act({ type: 'buyDev', player: me }); return; }
    setMode((m) => (m === b ? null : b));
    sound.play('click');
  };
  const onPlayDev = (k: DevKind) => {
    sound.unlock();
    if (k === 'knight') void act({ type: 'playKnight', player: me });
    else if (k === 'roadBuilding') void act({ type: 'playRoadBuilding', player: me });
    else if (k === 'yearOfPlenty') setDialog('yop');
    else if (k === 'monopoly') setDialog('monopoly');
  };

  const due = state.phase === 'discard' ? state.mustDiscard[me] : 0;
  const stealing = myTurn && state.phase === 'steal';
  const current = state.players[state.current];

  let banner: string;
  if (state.phase === 'gameOver') banner = state.winner === me ? 'You win! 🏆' : `${state.players[state.winner!].name} wins.`;
  else if (!myTurn && state.phase !== 'discard') banner = state.phase === 'setup' ? `${current.name} is placing…` : `${current.name}'s turn`;
  else switch (state.phase) {
    case 'setup': banner = state.setup!.step === 'settlement'
      ? (state.setup!.index < state.players.length ? 'Place your first settlement' : 'Place your second settlement. It collects its neighbours.')
      : 'Place a road next to it'; break;
    case 'roll': banner = playable.includes('knight') ? 'Roll the dice, or play a Knight first' : 'Roll the dice'; break;
    case 'discard': banner = due ? `Discard ${due} cards` : 'Waiting for others to discard…'; break;
    case 'robber': banner = 'Move the robber: click a hex'; break;
    case 'steal': banner = 'Choose who to rob'; break;
    case 'roadBuilding': banner = `Place a free road (${state.freeRoads} left)`; break;
    default: banner = mode ? `Click a glowing spot to build a ${mode}. Esc cancels.` : 'Build, trade, or end your turn';
  }

  return (
    <div className="table">
      <header className="topbar">
        <div className="brand">Settlers<span>of Catan</span></div>
        <div className={`turnline ${myTurn ? 'mine' : ''}`} style={{ '--pc': current.color } as React.CSSProperties}>
          <span className="dot" style={{ background: current.color }} />
          {banner}
        </div>
        <div className="topbtns">
          {inviteCode && (
            <button type="button" className="iconbtn code" title="Copy invite link" onClick={() => {
              const url = `${window.location.origin}${window.location.pathname}?room=${inviteCode}`;
              void navigator.clipboard?.writeText(url).then(() => toast('Invite link copied.'));
            }}>Room {inviteCode}</button>
          )}
          <button type="button" className="iconbtn" title={muted ? 'Sound on' : 'Mute'} onClick={() => {
            sound.unlock();
            const m = !muted;
            setMuted(m);
            sound.setVolumes({ sfx: m ? 0 : 0.8 });
          }}>{muted ? '🔇' : '🔊'}</button>
          <button type="button" className="iconbtn" title="Settings" onClick={() => setDialog('settings')}>⚙</button>
          <button type="button" className="iconbtn" title="How to play" onClick={() => setDialog('rules')}>?</button>
          <button type="button" className="iconbtn" title="Leave the table" onClick={onExit}>⏏</button>
        </div>
      </header>

      <aside className="side left">
        <PlayerList state={state} me={me} waiting={waiting} />
      </aside>

      <main className="boardwrap">
        <Board ref={board} state={state} pick={pick} pickColor={meP.color} lit={lit} onVertex={onVertex} onEdge={onEdge} onHex={onHex} />
        <div className="dice-spot">
          <Dice a={state.dice?.a ?? dice.a} b={state.dice?.b ?? dice.b} rollKey={dice.key} red={!!state.dice && state.dice.a + state.dice.b === 7} />
          {state.dice && <div className="dice-sum">{state.dice.a + state.dice.b}</div>}
        </div>
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.bad ? 'bad' : ''}`} style={{ '--pc': t.color ?? '#c99a3c' } as React.CSSProperties}>{t.text}</div>
          ))}
        </div>
        <IncomingOffer state={state} me={me} dispatch={act} />
      </main>

      <aside className="side right">
        <div className="panel-title">Bank</div>
        <BankView state={state} />
        <div className="panel-title">Game log</div>
        <GameLog state={state} me={me} />
      </aside>

      <footer className="dock">
        <div className="dock-hand">
          <HandView state={state} me={me} />
          <DevHand state={state} me={me} playable={playable} onPlay={onPlayDev} />
        </div>
        <div className="dock-actions">
          <BuildMenu state={state} me={me} mode={mode} onBuild={onBuild} reasons={reasons} />
          <div className="mainbtns">
            <button type="button" className="btn" disabled={!mainMine} onClick={() => { sound.unlock(); setDialog('trade'); }} title="Trade with the bank, harbours or players (T)">
              Trade
            </button>
            {myTurn && state.phase === 'roll' && (
              <button type="button" className="btn primary big pulse" onClick={() => act({ type: 'roll', player: me })} title="Roll the dice (R)">
                🎲 Roll
              </button>
            )}
            {myTurn && state.phase === 'roadBuilding' && (
              <button type="button" className="btn" onClick={() => act({ type: 'skipRoads', player: me })}>Skip free roads</button>
            )}
            {(!myTurn || state.phase !== 'roll') && (
              <button type="button" className="btn primary big" disabled={!mainMine || !!state.trade} onClick={() => act({ type: 'endTurn', player: me })}
                title={state.trade ? 'Close your trade offer first' : 'End your turn (E)'}>
                End turn
              </button>
            )}
          </div>
        </div>
      </footer>

      <button type="button" className="logfab" onClick={() => setDialog('log')} aria-label="Game log">📜</button>

      <FlyLayer ref={fly} />
      <Confetti run={confetti} />

      {due > 0 && <DiscardDialog key={`d${state.seq}`} state={state} me={me} due={due} dispatch={act} />}
      {stealing && <StealDialog state={state} targets={stealTargets(state, state.robber, me)} onPick={(p) => act({ type: 'steal', player: me, victim: p })} />}
      {dialog === 'trade' && mainMine && <TradeDialog state={state} me={me} onClose={() => setDialog(null)} dispatch={act} />}
      {dialog === 'yop' && (
        <YearOfPlentyDialog state={state} onClose={() => setDialog(null)} onPick={(take: PartialHand) => { setDialog(null); void act({ type: 'playYearOfPlenty', player: me, take }); }} />
      )}
      {dialog === 'monopoly' && (
        <MonopolyDialog onClose={() => setDialog(null)} onPick={(res) => { setDialog(null); void act({ type: 'playMonopoly', player: me, res }); }} />
      )}
      {dialog === 'rules' && <RulesDialog onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog speed={speed} setSpeed={setSpeed} onClose={() => { setDialog(null); setMuted(sound.sfxVolume === 0); }} />}
      {dialog === 'gameover' && state.phase === 'gameOver' && (
        <GameOverDialog state={state} me={me} onNew={onNewGame} onMenu={onExit} onClose={() => setDialog(null)} />
      )}
      {dialog === 'log' && (
        <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setDialog(null); }}>
          <div className="modal"><div className="modal-head"><h2>Game log</h2><button type="button" className="x" onClick={() => setDialog(null)}>✕</button></div><GameLog state={state} me={me} /></div>
        </div>
      )}
    </div>
  );
}

const RES_NAME: Record<Resource, string> = { wood: 'lumber', brick: 'brick', sheep: 'wool', wheat: 'grain', ore: 'ore' };
