import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import LandingPage from './LandingPage.tsx';
import GameLobby from './GameLobby.tsx';
import type { MultiplayerConfig } from './types.ts';
import type { GameState } from './types.ts';
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

type Screen = 'landing' | 'lobby' | 'game';

function Root() {
  const [screen, setScreen] = useState<Screen>('landing');
  const [multiplayerConfig, setMultiplayerConfig] = useState<MultiplayerConfig | undefined>();
  const [soloInitialState, setSoloInitialState] = useState<GameState | undefined>();
  const savedGame = useSavedGame();

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
        const saved = JSON.parse(raw) as GameState;
        setSoloInitialState(saved);
      }
    } catch {
      setSoloInitialState(undefined);
    }
    setMultiplayerConfig(undefined);
    setScreen('game');
  };

  const handleCreateMultiplayer = async (playerName: string) => {
    try {
      const roomId = await createGameRoom(playerName);
      setMultiplayerConfig({ roomId, mySlot: 0, isHost: true, playerName });
      setScreen('lobby');
    } catch (e) {
      console.error('Failed to create game room:', e);
      alert('Failed to create game room. Please check your connection and try again.');
    }
  };

  const handleJoinMultiplayer = async (roomCode: string, playerName: string) => {
    try {
      const result = await joinGameRoom(roomCode.toUpperCase(), playerName);
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
      setScreen('lobby');
      // Clear ?room= from URL without page reload
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());
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
      const p = roomData.players.find(pl => pl.slot === slot);
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
      await leaveGameRoom(multiplayerConfig.roomId, multiplayerConfig.mySlot);
    }
    setMultiplayerConfig(undefined);
    setSoloInitialState(undefined);
    setHasSoloSave(!!localStorage.getItem('catan_solo_save'));
    setScreen('landing');
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
        ⏳ Connecting to game room…
      </div>
    );
  }

  return (
    <App
      multiplayerConfig={multiplayerConfig}
      initialGameState={soloInitialState}
      onLeaveGame={handleLeaveGame}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
