import { describe, expect, it } from 'vitest';
import { simulate } from './sim';
import { totalVP } from '../rules';

describe('full games between computer players', () => {
  it('always finish with a winner, without breaking any rule', () => {
    const turns: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const { state, rejected } = simulate(seed, { check: true });
      expect(state.phase, `seed ${seed}`).toBe('gameOver');
      expect(state.winner).not.toBeNull();
      expect(totalVP(state, state.winner!)).toBeGreaterThanOrEqual(10);
      expect(rejected, `seed ${seed}`).toEqual([]);
      turns.push(state.turn);
    }
    const avg = turns.reduce((a, b) => a + b, 0) / turns.length;
    // Real 4-player games run about 60-80 turns (15-20 rounds).
    expect(avg).toBeGreaterThan(30);
    expect(avg).toBeLessThan(160);
  });

  it('works with three players and mixed difficulty', () => {
    for (let seed = 100; seed < 120; seed++) {
      const { state, rejected } = simulate(seed, { players: 3, levels: ['easy', 'normal', 'hard'], check: true });
      expect(state.phase).toBe('gameOver');
      expect(rejected).toEqual([]);
    }
  });

  it('is deterministic for a seed', () => {
    const a = simulate(42).state, b = simulate(42).state;
    expect(a.winner).toBe(b.winner);
    expect(a.turn).toBe(b.turn);
    expect(a.log.map((l) => l.text)).toEqual(b.log.map((l) => l.text));
  });
});
