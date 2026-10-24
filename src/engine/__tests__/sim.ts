// Plays whole games with computer players only. Shared by the tests and the
// balance script.

import { applyAction, createGame, waitingOn } from '../game';
import { chooseAction, fallbackAction } from '../ai';
import type { AiLevel, GameState } from '../types';
import { RESOURCES } from '../types';
import { BANK_SIZE, piecesLeft, totalVP } from '../rules';

export interface SimResult {
  state: GameState;
  steps: number;
  rejected: string[];
}

export function checkInvariants(s: GameState) {
  for (const r of RESOURCES) {
    const total = s.bank[r] + s.players.reduce((a, p) => a + p.hand[r], 0);
    if (total !== BANK_SIZE) throw new Error(`${r} total ${total} != ${BANK_SIZE}`);
    if (s.bank[r] < 0) throw new Error(`bank ${r} negative`);
    s.players.forEach((p) => { if (p.hand[r] < 0) throw new Error(`${p.name} ${r} negative`); });
  }
  s.players.forEach((_, i) => {
    const left = piecesLeft(s, i);
    if (left.road < 0 || left.settlement < 0 || left.city < 0) throw new Error('too many pieces');
  });
  const devs = s.devDeck.length + s.players.reduce((a, p) => a + p.devCards.length + p.stats.devPlayed, 0);
  if (devs !== 25) throw new Error(`dev cards ${devs} != 25`);
}

export function simulate(seed: number, opts: { levels?: AiLevel[]; maxSteps?: number; check?: boolean; players?: number } = {}): SimResult {
  const n = opts.players ?? 4;
  const levels = opts.levels ?? Array<AiLevel>(n).fill('normal');
  let s = createGame({
    seed,
    players: levels.map((l, i) => ({ name: `AI ${i}`, controller: 'ai', aiLevel: l })),
  });
  const rejected: string[] = [];
  let steps = 0;
  const max = opts.maxSteps ?? 6000;
  while (s.phase !== 'gameOver' && steps < max) {
    steps++;
    const who = waitingOn(s);
    // Answer trade offers before the offerer acts on them.
    const order = s.trade ? [...who.filter((p) => p !== s.current), s.current] : who;
    let moved = false;
    for (const p of order) {
      const act = chooseAction(s, p);
      if (!act) continue;
      let r = applyAction(s, act);
      if (!r.ok) {
        rejected.push(`${act.type}: ${r.error}`);
        const fb = fallbackAction(s, p);
        if (!fb) continue;
        r = applyAction(s, fb);
        if (!r.ok) throw new Error(`fallback ${fb.type} rejected: ${r.error} (phase ${s.phase})`);
      }
      s = r.state;
      if (opts.check) checkInvariants(s);
      moved = true;
      break;
    }
    if (!moved) throw new Error(`stuck in ${s.phase} waiting on ${who.join(',')}`);
  }
  if (s.winner !== null && totalVP(s, s.winner) < s.config.vpToWin) throw new Error('winner below target');
  return { state: s, steps, rejected };
}
