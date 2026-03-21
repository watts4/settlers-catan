import { useEffect, useState } from 'react';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  arrayUnion,
} from 'firebase/firestore';
import { db } from './firebase';

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
  authorizedUids: string[];  // top-level list of UIDs allowed to read/write this room
  players: GameRoomPlayer[];
  status: 'waiting' | 'playing' | 'finished';
  gameState?: Record<string, unknown>; // serialized GameState
  syncId?: string;
  stateVersion?: number;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getOrCreateSessionId(): string {
  const stored = localStorage.getItem('catan_session_id');
  if (stored) return stored;

  const id = crypto.randomUUID();
  localStorage.setItem('catan_session_id', id);
  return id;
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function generateId(): string {
  return crypto.randomUUID();
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
    authorizedUids: uid ? [uid] : [],
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
): Promise<{ slot: number; isHost: boolean; gameState?: unknown } | null> {
  const roomRef = doc(db, 'games', roomCode);
  const sessionId = getOrCreateSessionId();

  // Use a Firestore transaction to atomically read and update the room,
  // preventing race conditions when two players join simultaneously.
  const result = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);

    if (!snapshot.exists()) return null;

    const data = snapshot.data() as GameRoomData;

    // Late join: game already in progress — take over an AI slot
    if (data.status === 'playing') {
      const aiSlotEntry = data.players.find((p) => !p.isHuman);
      if (!aiSlotEntry) return null; // no AI slots to take over

      const slot = aiSlotEntry.slot;
      const newPlayer: GameRoomPlayer = {
        slot,
        name: playerName,
        ...(uid ? { uid } : {}),
        sessionId,
        isHuman: true,
        joinedAt: Date.now(),
      };

      const updatedPlayers = [
        ...data.players.filter((p) => p.slot !== slot),
        newPlayer,
      ];

      // Patch the live gameState so the host stops treating this slot as AI
      let updatedGameState = data.gameState;
      if (updatedGameState) {
        const gsPlayers = [...((updatedGameState as Record<string, unknown[]>).players ?? [])];
        gsPlayers[slot] = { ...(gsPlayers[slot] as Record<string, unknown>), isHuman: true, name: playerName };
        updatedGameState = { ...updatedGameState, players: gsPlayers };
      }

      transaction.update(roomRef, {
        players: updatedPlayers,
        gameState: updatedGameState,
        syncId: generateId(),
        updatedAt: Date.now(),
        ...(uid ? { authorizedUids: arrayUnion(uid) } : {}),
      });

      return { slot, isHost: false, gameState: updatedGameState };
    }

    if (data.status !== 'waiting') return null;

    const humanPlayers = data.players.filter((p) => p.isHuman);
    if (humanPlayers.length >= 4) return null;

    const newSlot = humanPlayers.length;

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

    transaction.update(roomRef, {
      players: updatedPlayers,
      updatedAt: Date.now(),
      ...(uid ? { authorizedUids: arrayUnion(uid) } : {}),
    });

    return { slot: newSlot, isHost: false };
  });

  if (result) {
    localStorage.setItem(
      'catan_active_game',
      JSON.stringify({ roomId: roomCode, slot: result.slot }),
    );
  }

  return result;
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
