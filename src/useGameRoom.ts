import { useEffect, useRef, useState } from 'react';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import type { GameState } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MultiplayerConfig {
  roomId: string;
  mySlot: number;   // 0-3, which player slot am I
  isHost: boolean;  // host handles AI turns
  playerName: string;
}

export interface GameRoomPlayer {
  slot: number;
  name: string;
  uid?: string;       // Firebase UID if signed in
  sessionId: string;  // localStorage session ID (always present)
  isHuman: boolean;   // true = human player, false = AI fills this slot
  joinedAt: number;
}

export interface GameRoomData {
  id: string;
  hostSessionId: string;
  players: GameRoomPlayer[];
  status: 'waiting' | 'playing' | 'finished';
  gameState?: Record<string, unknown>; // serialized GameState
  syncId?: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getOrCreateSessionId(): string {
  const stored = localStorage.getItem('catan_session_id');
  if (stored) return stored;

  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  localStorage.setItem('catan_session_id', id);
  return id;
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---------------------------------------------------------------------------
// useMultiplayerSync
// ---------------------------------------------------------------------------

export function useMultiplayerSync(
  game: GameState,
  setGame: (s: GameState) => void,
  roomId?: string,
): void {
  const lastSyncId = useRef<string>('');
  const isExternalUpdate = useRef<boolean>(false);

  // Write effect: push local state to Firestore
  useEffect(() => {
    if (!roomId) return;

    if (isExternalUpdate.current) {
      isExternalUpdate.current = false;
      return;
    }

    const syncId = generateId();
    lastSyncId.current = syncId;

    updateDoc(doc(db, 'games', roomId), {
      gameState: game as unknown as Record<string, unknown>,
      syncId,
      updatedAt: Date.now(),
    }).catch((err: unknown) => {
      console.error('[useMultiplayerSync] write failed:', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, roomId]);

  // Listener effect: receive remote updates
  useEffect(() => {
    if (!roomId) return;

    const unsub = onSnapshot(doc(db, 'games', roomId), (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data() as GameRoomData;

      // If this update was triggered by our own write, skip it
      if (data.syncId === lastSyncId.current) return;

      isExternalUpdate.current = true;
      setGame(data.gameState as unknown as GameState);
    });

    return unsub;
  }, [roomId, setGame]);
}

// ---------------------------------------------------------------------------
// createGameRoom
// ---------------------------------------------------------------------------

export async function createGameRoom(
  playerName: string,
  uid?: string,
): Promise<string> {
  const roomCode = generateRoomCode();
  const sessionId = getOrCreateSessionId();

  const roomData: GameRoomData = {
    id: roomCode,
    hostSessionId: sessionId,
    players: [
      {
        slot: 0,
        name: playerName,
        ...(uid ? { uid } : {}),
        sessionId,
        isHuman: true,
        joinedAt: Date.now(),
      },
    ],
    status: 'waiting',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await setDoc(doc(db, 'games', roomCode), roomData);

  localStorage.setItem('catan_active_game', JSON.stringify({ roomId: roomCode, slot: 0 }));

  return roomCode;
}

// ---------------------------------------------------------------------------
// joinGameRoom
// ---------------------------------------------------------------------------

export async function joinGameRoom(
  roomCode: string,
  playerName: string,
  uid?: string,
): Promise<{ slot: number; isHost: boolean } | null> {
  const roomRef = doc(db, 'games', roomCode);
  const snapshot = await getDoc(roomRef);

  if (!snapshot.exists()) return null;

  const data = snapshot.data() as GameRoomData;
  if (data.status !== 'waiting') return null;

  const humanPlayers = data.players.filter((p) => p.isHuman);
  if (humanPlayers.length >= 4) return null;

  const newSlot = humanPlayers.length;
  const sessionId = getOrCreateSessionId();

  const newPlayer: GameRoomPlayer = {
    slot: newSlot,
    name: playerName,
    ...(uid ? { uid } : {}),
    sessionId,
    isHuman: true,
    joinedAt: Date.now(),
  };

  // Replace any existing entry at this slot (e.g. an AI placeholder), then append the new player.
  // Using arrayUnion would create duplicate slot entries if the host pre-marked the slot as AI.
  const updatedPlayers = [
    ...data.players.filter((p) => p.slot !== newSlot),
    newPlayer,
  ];

  await updateDoc(roomRef, {
    players: updatedPlayers,
    updatedAt: Date.now(),
  });

  localStorage.setItem(
    'catan_active_game',
    JSON.stringify({ roomId: roomCode, slot: newSlot }),
  );

  return { slot: newSlot, isHost: false };
}

// ---------------------------------------------------------------------------
// useGameRoomLobby
// ---------------------------------------------------------------------------

export function useGameRoomLobby(roomId: string | null): {
  roomData: GameRoomData | null;
  loading: boolean;
} {
  const [roomData, setRoomData] = useState<GameRoomData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!roomId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const unsub = onSnapshot(doc(db, 'games', roomId), (snapshot) => {
      if (snapshot.exists()) {
        setRoomData(snapshot.data() as GameRoomData);
      } else {
        setRoomData(null);
      }
      setLoading(false);
    });

    return unsub;
  }, [roomId]);

  return { roomData, loading };
}

// ---------------------------------------------------------------------------
// startMultiplayerGame
// ---------------------------------------------------------------------------

export async function startMultiplayerGame(
  roomId: string,
  gameState: unknown,
): Promise<void> {
  await updateDoc(doc(db, 'games', roomId), {
    status: 'playing',
    gameState,
    syncId: generateId(),
    updatedAt: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// leaveGameRoom
// ---------------------------------------------------------------------------

export async function leaveGameRoom(roomId: string, slot: number): Promise<void> {
  const roomRef = doc(db, 'games', roomId);
  const snapshot = await getDoc(roomRef);

  if (!snapshot.exists()) {
    localStorage.removeItem('catan_active_game');
    return;
  }

  const data = snapshot.data() as GameRoomData;

  // Mark the player's slot as AI instead of human
  const updatedPlayers = data.players.map((p) => {
    if (p.slot === slot) {
      return { ...p, isHuman: false, name: `AI (was ${p.name})` };
    }
    return p;
  });

  await updateDoc(roomRef, {
    players: updatedPlayers,
    updatedAt: Date.now(),
  });

  localStorage.removeItem('catan_active_game');
}

// ---------------------------------------------------------------------------
// useSavedGame
// ---------------------------------------------------------------------------

export function useSavedGame(): { roomId: string; slot: number } | null {
  const raw = localStorage.getItem('catan_active_game');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { roomId: string; slot: number };
    if (parsed.roomId && typeof parsed.slot === 'number') return parsed;
    return null;
  } catch {
    return null;
  }
}
