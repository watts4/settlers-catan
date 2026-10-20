// Game controllers: a local game kept in memory (and localStorage), or an
// online game kept in Firestore. Both expose the same shape to the screen, and
// both run computer players through `useAiDriver`.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action, GameState } from '../engine/types';
import { applyAction, waitingOn } from '../engine/game';
import { chooseAction, fallbackAction } from '../engine/ai';
import { sendAction, useRoom, type Room } from '../net/rooms';

export interface GameController {
  state: GameState | null;
  me: number;                 // the seat this screen plays
  online: boolean;
  room: Room | null;
  error: string | null;
  dispatch(a: Action): Promise<string | null>;
}

export const SOLO_SAVE = 'catan2_solo_save';

export function useLocalGame(initial: GameState, me: number, aiSpeed: number): GameController {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  const dispatch = useCallback(async (a: Action) => {
    const r = applyAction(ref.current, a);
    if (!r.ok) return r.error;
    ref.current = r.state;
    setState(r.state);
    try {
      if (r.state.phase === 'gameOver') localStorage.removeItem(SOLO_SAVE);
      else localStorage.setItem(SOLO_SAVE, JSON.stringify(r.state));
    } catch { /* storage full or blocked; the game goes on */ }
    return null;
  }, []);
  useAiDriver(state, dispatch, true, aiSpeed);
  return { state, me, online: false, room: null, error: null, dispatch };
}

export function useOnlineGame(roomId: string, me: number, aiSpeed: number): GameController {
  const { room, error } = useRoom(roomId);
  const state = room?.gameState ?? null;
  const dispatch = useCallback((a: Action) => sendAction(roomId, a), [roomId]);
  // Only one screen moves the computer players: the lowest seat still held
  // by a person. If the host leaves, the next person picks it up.
  const humans = room?.players.filter((p) => p.isHuman).map((p) => p.slot) ?? [];
  const driver = humans.length ? Math.min(...humans) : me;
  useAiDriver(state, dispatch, !!room && me === driver, aiSpeed);
  return { state, me, online: true, room, error, dispatch };
}

// Pauses before each computer move, in ms, at speed 1.
const PACE: Partial<Record<Action['type'], number>> = {
  roll: 900, placeSettlement: 700, placeRoad: 550, buildRoad: 650, buildSettlement: 800, buildCity: 800,
  buyDev: 700, moveRobber: 900, steal: 700, discard: 600, endTurn: 650, respondTrade: 900,
  offerTrade: 700, acceptTrade: 600, cancelTrade: 400, bankTrade: 700,
  playKnight: 800, playMonopoly: 900, playYearOfPlenty: 900, playRoadBuilding: 800,
};

export function useAiDriver(state: GameState | null, dispatch: (a: Action) => Promise<string | null>, enabled: boolean, speed: number) {
  const busy = useRef(false);
  useEffect(() => {
    if (!enabled || !state || state.phase === 'gameOver') return;
    const waiting = waitingOn(state);
    const isAi = (p: number) => state.players[p]?.controller === 'ai';

    // Computer players answer an open offer first.
    const responders = state.trade ? waiting.filter((p) => p !== state.trade!.from && isAi(p)) : [];
    let actor: number | null = responders[0] ?? null;
    let wait = 0;
    if (actor === null) {
      const cur = state.current;
      if (state.trade && state.trade.from === cur && isAi(cur)) {
        // Our offer is out. Wait for people to answer, but not forever.
        const pending = Object.values(state.trade.responses).some((r) => r === 'pending');
        actor = cur;
        wait = pending ? 12000 : 0;
      } else {
        actor = waiting.find((p) => isAi(p) && (state.phase === 'discard' || p === cur) && !(state.trade && p === cur && !isAi(cur))) ?? null;
      }
    }
    if (actor === null) return;
    const p = actor;
    const planned = chooseAction(state, p) ?? fallbackAction(state, p);
    if (!planned) return;
    // A dice roll needs time to land before the next move.
    const afterRoll = state.events.length && state.events[state.events.length - 1].kind === 'roll' ? 900 : 0;
    const delay = (wait || (PACE[planned.type] ?? 600) + afterRoll) / Math.max(0.25, speed);
    const timer = window.setTimeout(async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const err = await dispatch(planned);
        if (err) {
          const fb = fallbackAction(state, p);
          if (fb) await dispatch(fb);
        }
      } finally {
        busy.current = false;
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [state, enabled, dispatch, speed]);
}
