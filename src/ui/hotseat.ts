// Pass-and-play: several people share one screen. The seat on screen follows
// whoever has to act; a curtain hides the hand while the device changes hands.

import { useState } from 'react';
import type { GameState } from '../engine/types';

// Which person should be looking at the screen right now.
export function activeSeat(s: GameState, fallback: number): number {
  const humans = s.players.map((p, i) => (p.controller === 'human' ? i : -1)).filter((i) => i >= 0);
  if (humans.length <= 1) return humans[0] ?? fallback;
  const isHuman = (i: number) => humans.includes(i);
  // Someone owes an answer to a trade offer.
  if (s.trade) {
    const owed = Object.entries(s.trade.responses).find(([k, v]) => v === 'pending' && isHuman(Number(k)));
    if (owed) return Number(owed[0]);
  }
  // Discards after a seven, one person at a time.
  if (s.phase === 'discard') {
    const due = Object.keys(s.mustDiscard).map(Number).find(isHuman);
    if (due !== undefined) return due;
  }
  if (isHuman(s.current)) return s.current;
  // A computer is playing: keep showing whoever played last.
  return isHuman(fallback) ? fallback : humans[0];
}

export function handoverReason(s: GameState, seat: number): string {
  if (s.trade && s.trade.from !== seat && s.trade.responses[seat] === 'pending') return `${s.players[s.trade.from].name} is offering you a trade.`;
  if (s.phase === 'discard' && s.mustDiscard[seat]) return 'A seven was rolled: you need to discard.';
  if (s.phase === 'setup') return 'Your turn to place.';
  return 'Your turn.';
}

// Tracks which seat is on screen and whether its owner has taken the device.
export function useHandover(s: GameState | null, enabled: boolean) {
  const [shown, setShown] = useState<number | null>(null);
  const [last, setLast] = useState(0);
  const seat = s && enabled ? activeSeat(s, last) : null;
  // Remember the last person who had the device (adjusting state during render).
  if (seat !== null && seat !== last) setLast(seat);
  return {
    seat,
    curtain: enabled && seat !== null && shown !== seat && s?.phase !== 'gameOver',
    reveal: () => setShown(seat),
  };
}
