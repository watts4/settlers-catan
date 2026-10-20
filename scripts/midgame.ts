// Writes a mid-game save (JSON) for visual testing: computer players play
// until turn N, then seat 0 is handed to a person at the start of their turn.
// Run: npx vite-node scripts/midgame.ts <turn> <out.json>
import { writeFileSync } from 'node:fs';
import { applyAction, createGame, waitingOn } from '../src/engine/game';
import { chooseAction, fallbackAction } from '../src/engine/ai';

const target = Number(process.argv[2] ?? 30);
let s = createGame({ seed: 777, firstPlayer: 0, players: ['You', 'Hildeguard', 'Steve', 'Tammy'].map((name) => ({ name, controller: 'ai' as const })) });
for (let i = 0; i < 20000 && s.phase !== 'gameOver'; i++) {
  if (s.turn >= target && s.current === 0 && s.phase === 'roll') break;
  const who = waitingOn(s);
  const order = s.trade ? [...who.filter((p) => p !== s.current), s.current] : who;
  for (const p of order) {
    const a = chooseAction(s, p) ?? fallbackAction(s, p);
    if (!a) continue;
    const r = applyAction(s, a);
    if (r.ok) { s = r.state; break; }
  }
}
s.players[0].controller = 'human';
writeFileSync(process.argv[3] ?? 'midgame.json', JSON.stringify(s));
console.log('turn', s.turn, 'phase', s.phase, 'current', s.current, 'hand', s.players[0].hand);
