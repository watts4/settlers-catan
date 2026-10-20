// A fresh island: shuffled terrain, number tokens that keep the red 6s and 8s
// apart, and nine harbours spaced around the coast.

import type { HexTile, PortSpot, Resource, Terrain } from './types';
import { NEIGHBOURS, hexagon, topology } from './geometry';
import type { Rng } from './rng';

const TERRAIN: Terrain[] = [
  'wood', 'wood', 'wood', 'wood',
  'sheep', 'sheep', 'sheep', 'sheep',
  'wheat', 'wheat', 'wheat', 'wheat',
  'brick', 'brick', 'brick',
  'ore', 'ore', 'ore',
  'desert',
];
const NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const PORT_KINDS: PortSpot['kind'][] = ['any', 'any', 'any', 'any', 'wood', 'brick', 'sheep', 'wheat', 'ore'];
// Gaps between harbours along the 30 coastline edges of the standard island.
const PORT_GAPS = [3, 3, 4, 3, 3, 4, 3, 3, 4];

// Number of ways to roll each number out of 36 (the dots on the token).
export const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

export function generateIsland(rng: Rng): { hexes: HexTile[]; ports: PortSpot[]; robber: number } {
  const coords = hexagon(2);
  const terrain = rng.shuffle([...TERRAIN]);
  const index = new Map(coords.map((c, i) => [`${c.q},${c.r}`, i]));
  const neighbours = coords.map((c) => NEIGHBOURS
    .map(([dq, dr]) => index.get(`${c.q + dq},${c.r + dr}`))
    .filter((i): i is number => i !== undefined));

  // Deal number tokens until no two hot numbers (6, 8) touch and no two equal
  // numbers touch. This almost always succeeds within a few dozen tries.
  let numbers: (number | null)[] = [];
  for (let attempt = 0; attempt < 2000; attempt++) {
    const deck = rng.shuffle([...NUMBERS]);
    numbers = terrain.map((t) => (t === 'desert' ? null : deck.pop()!));
    const ok = numbers.every((n, i) => n === null || neighbours[i].every((j) => {
      const m = numbers[j];
      if (m === null) return true;
      if ((n === 6 || n === 8) && (m === 6 || m === 8)) return false;
      return n !== m;
    }));
    if (ok) break;
  }

  const hexes: HexTile[] = coords.map((c, i) => ({ q: c.q, r: c.r, terrain: terrain[i], number: numbers[i] }));
  const topo = topology(hexes);
  const kinds = rng.shuffle([...PORT_KINDS]);
  const start = rng.int(topo.coast.length);
  const ports: PortSpot[] = [];
  let pos = start;
  PORT_GAPS.forEach((gap, i) => {
    ports.push({ edge: topo.coast[pos % topo.coast.length], kind: kinds[i] });
    pos += gap;
  });

  return { hexes, ports, robber: terrain.indexOf('desert') };
}

export function resourceOf(t: Terrain): Resource | null {
  return t === 'desert' ? null : t;
}
