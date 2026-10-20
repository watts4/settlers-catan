// Plays many computer-only games and prints how they went.
// Run: npx vite-node scripts/balance.ts [games]
import { simulate } from '../src/engine/__tests__/sim';
import { totalVP } from '../src/engine/rules';

const games = Number(process.argv[2] ?? 100);
const wins: Record<string, number> = {};
const turns: number[] = [];
const rejected = new Map<string, number>();
let stuck = 0;
const t0 = Date.now();
const levels = (process.argv[3] ?? 'normal,normal,normal,normal').split(',') as ('easy' | 'normal' | 'hard')[];
for (let seed = 1; seed <= games; seed++) {
  try {
    const r = simulate(seed * 7919, { levels });
    if (r.state.winner === null) { stuck++; continue; }
    const w = `${r.state.winner}:${levels[r.state.winner]}`;
    wins[w] = (wins[w] ?? 0) + 1;
    turns.push(r.state.turn);
    r.rejected.forEach((x) => rejected.set(x, (rejected.get(x) ?? 0) + 1));
    void totalVP;
  } catch (e) {
    console.log(`seed ${seed * 7919}:`, (e as Error).message);
    stuck++;
  }
}
turns.sort((a, b) => a - b);
console.log(`${games} games in ${((Date.now() - t0) / 1000).toFixed(1)}s, unfinished ${stuck}`);
console.log('wins by seat:', wins);
console.log(`turns: median ${turns[turns.length >> 1]}, p10 ${turns[Math.floor(turns.length * 0.1)]}, p90 ${turns[Math.floor(turns.length * 0.9)]}`);
console.log('rejected moves:', [...rejected.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10));
