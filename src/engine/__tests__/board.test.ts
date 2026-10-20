import { describe, expect, it } from 'vitest';
import { hexagon, topology } from '../geometry';
import { generateIsland, PIPS } from '../board';
import { makeRng } from '../rng';
import { NEIGHBOURS } from '../geometry';

describe('island geometry', () => {
  const topo = topology(hexagon(2));

  it('has the standard 19 hexes, 54 corners and 72 sides', () => {
    expect(hexagon(2)).toHaveLength(19);
    expect(topo.vertexIds).toHaveLength(54);
    expect(topo.edgeIds).toHaveLength(72);
    expect(topo.coast).toHaveLength(30);
  });

  it('links every corner to 2 or 3 neighbours and every side to two corners', () => {
    for (const v of Object.values(topo.vertices)) {
      expect([2, 3]).toContain(v.adj.length);
      expect(v.adj.length).toBe(v.edges.length);
      expect(v.hexes.length).toBeGreaterThanOrEqual(1);
      expect(v.hexes.length).toBeLessThanOrEqual(3);
    }
    for (const e of Object.values(topo.edges)) {
      expect(topo.vertices[e.a].adj).toContain(e.b);
    }
  });

  it('gives each hex six distinct corners and sides', () => {
    topo.hexCorners.forEach((c) => expect(new Set(c).size).toBe(6));
    topo.hexEdges.forEach((c) => expect(new Set(c).size).toBe(6));
  });
});

describe('island generation', () => {
  it('deals the standard tiles and tokens', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { hexes, ports, robber } = generateIsland(makeRng(seed));
      const count = (t: string) => hexes.filter((h) => h.terrain === t).length;
      expect([count('wood'), count('sheep'), count('wheat'), count('brick'), count('ore'), count('desert')]).toEqual([4, 4, 4, 3, 3, 1]);
      expect(hexes[robber].terrain).toBe('desert');
      expect(hexes.filter((h) => h.number === null)).toHaveLength(1);
      expect(hexes.map((h) => h.number).filter(Boolean).sort((a, b) => a! - b!))
        .toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
      expect(ports).toHaveLength(9);
      expect(ports.filter((p) => p.kind === 'any')).toHaveLength(4);
    }
  });

  it('never puts 6s and 8s next to each other', () => {
    for (let seed = 1; seed < 200; seed++) {
      const { hexes } = generateIsland(makeRng(seed));
      const at = new Map(hexes.map((h) => [`${h.q},${h.r}`, h]));
      for (const h of hexes) {
        if (h.number !== 6 && h.number !== 8) continue;
        for (const [dq, dr] of NEIGHBOURS) {
          const n = at.get(`${h.q + dq},${h.r + dr}`);
          expect(n?.number === 6 || n?.number === 8).toBe(false);
        }
      }
    }
  });

  it('keeps harbours from sharing a corner', () => {
    for (let seed = 1; seed < 50; seed++) {
      const isl = generateIsland(makeRng(seed));
      const topo = topology(isl.hexes);
      const corners = isl.ports.flatMap((p) => [topo.edges[p.edge].a, topo.edges[p.edge].b]);
      expect(new Set(corners).size).toBe(18);
    }
  });

  it('has 58 pips of production in total', () => {
    const { hexes } = generateIsland(makeRng(7));
    expect(hexes.reduce((n, h) => n + (PIPS[h.number ?? 0] ?? 0), 0)).toBe(58);
  });
});
