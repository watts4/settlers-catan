// Online rooms in Firestore. One document per room holds the seats and, once
// the host starts, the whole game state. Every move is a transaction: read the
// latest state, apply the move with the rules engine, write it back. If two
// players move at once, Firestore retries the loser against the new state.

import { useEffect, useState } from 'react';
import { arrayUnion, doc, getDoc, onSnapshot, runTransaction, setDoc, updateDoc } from 'firebase/firestore';
import { db, ensureAuth } from '../firebase';
import type { Action, GameState } from '../engine/types';
import { applyAction } from '../engine/game';

export interface Seat {
  slot: number;
  name: string;
  uid?: string;
  sessionId: string;
  isHuman: boolean;
  joinedAt: number;
}

export interface Room {
  id: string;
  hostSessionId: string;
  authorizedUids: string[];
  players: Seat[];
  status: 'waiting' | 'playing' | 'finished';
  gameState?: GameState;
  stateVersion?: number;
  options?: { seats: number; vpToWin: number; friendlyRobber: boolean };
  createdAt: number;
  updatedAt: number;
}

const ACTIVE = 'catan2_active_room';

export function sessionId(): string {
  let id = localStorage.getItem('catan_session_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('catan_session_id', id);
  }
  return id;
}

export function rememberRoom(roomId: string, slot: number) {
  localStorage.setItem(ACTIVE, JSON.stringify({ roomId, slot, at: Date.now() }));
}
export function forgetRoom() { localStorage.removeItem(ACTIVE); }
export function rememberedRoom(): { roomId: string; slot: number } | null {
  try {
    const r = JSON.parse(localStorage.getItem(ACTIVE) ?? 'null');
    if (r && Date.now() - (r.at ?? 0) < 24 * 3600 * 1000) return r;
  } catch { /* none */ }
  return null;
}

function code(): string {
  // No 0/O or 1/I so codes are easy to read aloud.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => chars[b % chars.length]).join('');
}

export async function createRoom(name: string): Promise<string> {
  const uid = await ensureAuth();
  let id = code();
  for (let i = 0; i < 5; i++) {
    try {
      const snap = await getDoc(doc(db, 'games', id));
      if (!snap.exists()) break;
    } catch { break; } // unreadable means it isn't ours; a collision is very unlikely
    id = code();
  }
  const now = Date.now();
  const room: Room = {
    id,
    hostSessionId: sessionId(),
    authorizedUids: [uid],
    players: [{ slot: 0, name, uid, sessionId: sessionId(), isHuman: true, joinedAt: now }],
    status: 'waiting',
    options: { seats: 4, vpToWin: 10, friendlyRobber: false },
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(doc(db, 'games', id), room);
  rememberRoom(id, 0);
  return id;
}

export type JoinResult = { slot: number; playing: boolean } | { error: string };

export async function joinRoom(id: string, name: string): Promise<JoinResult> {
  const uid = await ensureAuth();
  const ref = doc(db, 'games', id);
  const sid = sessionId();
  try {
    const res = await runTransaction(db, async (tx): Promise<JoinResult> => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { error: 'No game with that code.' };
      const room = snap.data() as Room;
      // Coming back to a seat you already have.
      const mine = room.players.find((p) => p.isHuman && (p.uid === uid || p.sessionId === sid));
      if (mine) return { slot: mine.slot, playing: room.status === 'playing' };
      const seats = room.options?.seats ?? 4;
      if (room.status === 'waiting') {
        const taken = new Set(room.players.map((p) => p.slot));
        const slot = Array.from({ length: seats }, (_, i) => i).find((i) => !taken.has(i));
        if (slot === undefined) return { error: 'That game is full.' };
        tx.update(ref, {
          players: [...room.players, { slot, name, uid, sessionId: sid, isHuman: true, joinedAt: Date.now() }],
          authorizedUids: arrayUnion(uid),
          updatedAt: Date.now(),
        });
        return { slot, playing: false };
      }
      if (room.status === 'playing' && room.gameState) {
        // Take over a computer player mid-game.
        const gs = room.gameState;
        const slot = gs.players.findIndex((p) => p.controller === 'ai');
        if (slot < 0) return { error: 'That game has already started and every seat is taken.' };
        const next = structuredClone(gs);
        next.players[slot].controller = 'human';
        next.players[slot].name = name;
        next.log.push({ turn: next.turn, player: slot, text: `${name} joins and takes over this seat.` });
        tx.update(ref, {
          players: [...room.players.filter((p) => p.slot !== slot), { slot, name, uid, sessionId: sid, isHuman: true, joinedAt: Date.now() }],
          authorizedUids: arrayUnion(uid),
          gameState: next,
          stateVersion: (room.stateVersion ?? 0) + 1,
          updatedAt: Date.now(),
        });
        return { slot, playing: true };
      }
      return { error: 'That game has finished.' };
    });
    if ('slot' in res) rememberRoom(id, res.slot);
    return res;
  } catch (e) {
    const msg = (e as { code?: string }).code;
    if (msg === 'permission-denied') return { error: 'The server wouldn\'t let you join. Ask the host for a fresh link.' };
    return { error: 'Couldn\'t reach the game server. Check your connection.' };
  }
}

export function useRoom(id: string | null): { room: Room | null; error: string | null } {
  // Results are tagged with the room id so a stale room never shows after a switch.
  const [data, setData] = useState<{ id: string; room: Room | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!id) return;
    let unsub = () => {};
    let cancelled = false;
    ensureAuth().then(() => {
      if (cancelled) return;
      unsub = onSnapshot(doc(db, 'games', id),
        (snap) => setData({ id, room: snap.exists() ? (snap.data() as Room) : null, error: null }),
        (e) => setData({ id, room: null, error: e.code === 'permission-denied' ? 'You are not part of this game.' : 'Lost connection to the game.' }));
    }).catch(() => setData({ id, room: null, error: 'Couldn\'t sign in to the game server.' }));
    return () => { cancelled = true; unsub(); };
  }, [id]);
  if (!id || data?.id !== id) return { room: null, error: null };
  return { room: data.room, error: data.error };
}

export async function updateSeats(id: string, players: Seat[], options?: Room['options']) {
  await updateDoc(doc(db, 'games', id), { players, ...(options ? { options } : {}), updatedAt: Date.now() });
}

export async function startRoom(id: string, state: GameState) {
  await updateDoc(doc(db, 'games', id), { status: 'playing', gameState: state, stateVersion: 1, updatedAt: Date.now() });
}

// Apply one move against the latest server state. Returns an error message
// when the rules engine rejects it.
export async function sendAction(id: string, action: Action): Promise<string | null> {
  const ref = doc(db, 'games', id);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const room = snap.data() as Room | undefined;
      if (!room?.gameState) return 'The game isn\'t running.';
      const r = applyAction(room.gameState, action);
      if (!r.ok) return r.error;
      tx.update(ref, { gameState: r.state, stateVersion: (room.stateVersion ?? 0) + 1, updatedAt: Date.now() });
      return null;
    });
  } catch {
    return 'Couldn\'t reach the game server. Try again.';
  }
}

// Leaving mid-game hands your seat to a computer player.
export async function leaveRoom(id: string, slot: number) {
  const ref = doc(db, 'games', id);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const room = snap.data() as Room | undefined;
      if (!room) return;
      const players = room.players.map((p) => (p.slot === slot ? { ...p, isHuman: false } : p));
      const upd: Partial<Room> = { players, updatedAt: Date.now() };
      if (room.gameState && room.status === 'playing') {
        const gs = structuredClone(room.gameState);
        if (gs.players[slot]) {
          gs.players[slot].controller = 'ai';
          gs.log.push({ turn: gs.turn, player: slot, text: `${gs.players[slot].name} left; the computer takes over.` });
        }
        upd.gameState = gs;
        upd.stateVersion = (room.stateVersion ?? 0) + 1;
      }
      tx.update(ref, upd);
    });
  } catch { /* leaving should never block the player */ }
  forgetRoom();
}
