import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import LandingPage from './LandingPage.tsx';
import GameLobby from './GameLobby.tsx';
import ProfilePage from './ProfilePage.tsx';
import type { MultiplayerConfig } from './types.ts';
import type { GameState } from './types.ts';
import { isValidGameState } from './types.ts';
import type { GameRoomData } from './useGameRoom.ts';
import {
  createGameRoom,
  joinGameRoom,
  useSavedGame,
  useGameRoomLobby,
  startMultiplayerGame,
  leaveGameRoom,
} from './useGameRoom.ts';
import { createInitialGameState } from './gameState.ts';
import type { PlayerConfig } from './gameState.ts';
import { auth, ensureAuth } from './firebase.ts';
import { onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';

type Screen = 'landing' | 'lobby' | 'game' | 'profile';

function Root() {
  const [screen, setScreen] = useState<Screen>('landing');
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);
  const [multiplayerConfig, setMultiplayerConfig] = useState<MultiplayerConfig | undefined>();
  const [soloInitialState, setSoloInitialState] = useState<GameState | undefined>();
  const savedGame = useSavedGame();

  // Initial game state — used for solo resume AND multiplayer (non-host gets state from lobby)
  const [mpInitialState, setMpInitialState] = useState<GameState | undefined>();

  // Check for solo save in localStorage
  const [hasSoloSave, setHasSoloSave] = useState(() => {
    return !!localStorage.getItem('catan_solo_save');
  });

  // URL-based room code (for invite links: ?room=XKCD42)
  const [initialRoomCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room')?.toUpperCase() ?? null;
  });

  // Lobby data subscription
  const { roomData } = useGameRoomLobby(
    screen === 'lobby' && multiplayerConfig ? multiplayerConfig.roomId : null
  );

  // When game starts (host writes gameState to Firestore), non-host clients transition to game
  useEffect(() => {
    if (screen !== 'lobby' || !roomData || !multiplayerConfig) return;
    if (roomData.status === 'playing') {
      // Non-host: grab the game state written by the host so App doesn't create a default
      if (!multiplayerConfig.isHost && isValidGameState(roomData.gameState)) {
        setMpInitialState(roomData.gameState);
      }
      setScreen('game');
    }
  }, [roomData, screen, multiplayerConfig]);

  const handlePlaySolo = () => {
    // Start fresh — clear any existing save
    localStorage.removeItem('catan_solo_save');
    setHasSoloSave(false);
    setSoloInitialState(undefined);
    setMultiplayerConfig(undefined);
    setScreen('game');
  };

  const handleDiscardSolo = () => {
    localStorage.removeItem('catan_solo_save');
    setHasSoloSave(false);
  };

  const handleResumeSolo = () => {
    try {
      const raw = localStorage.getItem('catan_solo_save');
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isValidGameState(parsed)) {
          setSoloInitialState(parsed);
        } else {
          console.warn('Solo save data is invalid — starting fresh');
          localStorage.removeItem('catan_solo_save');
        }
      }
    } catch {
      setSoloInitialState(undefined);
    }
    setMultiplayerConfig(undefined);
    setScreen('game');
  };

  const handleCreateMultiplayer = async (playerName: string) => {
    try {
      const uid = await ensureAuth();
      const roomId = await createGameRoom(playerName, uid);
      setMultiplayerConfig({ roomId, mySlot: 0, isHost: true, playerName });
      setScreen('lobby');
    } catch (e) {
      console.error('Failed to create game room:', e);
      alert('Failed to create game room. Please check your connection and try again.');
    }
  };

  const handleJoinMultiplayer = async (roomCode: string, playerName: string) => {
    try {
      const uid = await ensureAuth();
      const result = await joinGameRoom(roomCode.toUpperCase(), playerName, uid);
      if (!result) {
        alert('Game room not found or already full. Check the code and try again.');
        return;
      }
      setMultiplayerConfig({
        roomId: roomCode.toUpperCase(),
        mySlot: result.slot,
        isHost: result.isHost,
        playerName,
      });
      // Clear ?room= from URL without page reload
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());

      if (isValidGameState(result.gameState)) {
        // Late join: game already in progress — skip lobby, go straight to game
        setMpInitialState(result.gameState);
        setScreen('game');
      } else {
        setScreen('lobby');
      }
    } catch (e) {
      console.error('Failed to join game room:', e);
      alert('Failed to join game room. Please try again.');
    }
  };

  const handleRejoinGame = async (roomId: string, slot: number) => {
    setMultiplayerConfig({ roomId, mySlot: slot, isHost: slot === 0, playerName: 'Player' });
    setScreen('lobby');
  };

  const handleStartGame = async () => {
    if (!multiplayerConfig || !roomData) return;
    const playerConfigs: PlayerConfig[] = [0, 1, 2, 3].map(slot => {
      const playersInSlot = roomData.players.filter(pl => pl.slot === slot);
      // Prefer human players over AI entries — handles the case where a slot was
      // pre-marked as AI and then a human joined it (two entries for the same slot)
      const p = playersInSlot.find(pl => pl.isHuman) ?? playersInSlot[0];
      return {
        name: p?.name ?? `Player ${slot + 1}`,
        isHuman: p?.isHuman ?? false,
      };
    });
    const initialState = createInitialGameState(playerConfigs);
    await startMultiplayerGame(multiplayerConfig.roomId, initialState);
    setScreen('game');
  };

  const handleLeaveGame = async () => {
    if (multiplayerConfig) {
      try {
        await leaveGameRoom(multiplayerConfig.roomId, multiplayerConfig.mySlot);
      } catch (e) {
        console.error('Failed to mark slot as AI on leave:', e);
        // Continue navigation regardless — local state must always clean up
      }
    }
    setMultiplayerConfig(undefined);
    setSoloInitialState(undefined);
    setHasSoloSave(!!localStorage.getItem('catan_solo_save'));
    setScreen('landing');
  };

  const handleViewProfile = () => {
    setScreen('profile');
  };

  if (screen === 'landing') {
    return (
      <LandingPage
        onPlaySolo={handlePlaySolo}
        onResumeSolo={handleResumeSolo}
        onDiscardSolo={handleDiscardSolo}
        hasSoloSave={hasSoloSave}
        onCreateMultiplayer={handleCreateMultiplayer}
        onJoinMultiplayer={handleJoinMultiplayer}
        savedGame={savedGame}
        onRejoinGame={handleRejoinGame}
        initialRoomCode={initialRoomCode}
        onViewProfile={handleViewProfile}
        isSignedIn={!!user}
      />
    );
  }

  if (screen === 'profile' && user) {
    return (
      <ProfilePage
        uid={user.uid}
        displayName={user.displayName ?? 'Player'}
        photoURL={user.photoURL}
        onBack={() => setScreen('landing')}
      />
    );
  }

  if (screen === 'lobby' && multiplayerConfig && roomData) {
    return (
      <GameLobby
        roomId={multiplayerConfig.roomId}
        mySlot={multiplayerConfig.mySlot}
        isHost={multiplayerConfig.isHost}
        roomData={roomData as GameRoomData}
        onStartGame={handleStartGame}
        onLeave={handleLeaveGame}
      />
    );
  }

  if (screen === 'lobby' && !roomData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d1117', color: '#fff', fontSize: '1.2rem' }}>
        Connecting to game room...
      </div>
    );
  }

  return (
    <App
      multiplayerConfig={multiplayerConfig}
      initialGameState={soloInitialState ?? mpInitialState}
      onLeaveGame={handleLeaveGame}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
