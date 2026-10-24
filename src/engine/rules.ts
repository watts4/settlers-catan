// Read-only questions about a game state: what can be built where, what it
// costs, who has how many points. The reducer and the AI both lean on these.

import type { DevKind, GameState, Hand, PartialHand, Resource } from './types';
import { RESOURCES } from './types';
import { topology, type Topology } from './geometry';
import { PIPS } from './board';

export const COST = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  dev: { sheep: 1, wheat: 1, ore: 1 },
} satisfies Record<string, PartialHand>;
export type Buildable = keyof typeof COST;

export const PIECES = { road: 15, settlement: 5, city: 4 };
export const BANK_SIZE = 19;
export const DEV_DECK: DevKind[] = [
  ...Array<DevKind>(14).fill('knight'),
  ...Array<DevKind>(5).fill('victory'),
  ...Array<DevKind>(2).fill('roadBuilding'),
  ...Array<DevKind>(2).fill('yearOfPlenty'),
  ...Array<DevKind>(2).fill('monopoly'),
];

export const topo = (s: GameState): Topology => topology(s.hexes);

export const emptyHand = (): Hand => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
export const handSize = (h: PartialHand): number => RESOURCES.reduce((n, r) => n + (h[r] ?? 0), 0);
export const canAfford = (h: Hand, cost: PartialHand): boolean => RESOURCES.every((r) => h[r] >= (cost[r] ?? 0));

export function piecesUsed(s: GameState, p: number) {
  let settlement = 0, city = 0;
  for (const b of Object.values(s.buildings)) {
    if (b.owner !== p) continue;
    if (b.kind === 'city') city++; else settlement++;
  }
  const road = Object.values(s.roads).filter((o) => o === p).length;
  return { road, settlement, city };
}

export function piecesLeft(s: GameState, p: number) {
  const u = piecesUsed(s, p);
  return { road: PIECES.road - u.road, settlement: PIECES.settlement - u.settlement, city: PIECES.city - u.city };
}

// ── Placement ───────────────────────────────────────────────────────────────

// Distance rule: the corner and every neighbouring corner must be empty.
export function vertexOpen(s: GameState, v: string): boolean {
  if (s.buildings[v]) return false;
  return topo(s).vertices[v].adj.every((n) => !s.buildings[n]);
}

function touchesOwnRoad(s: GameState, p: number, v: string): boolean {
  return topo(s).vertices[v].edges.some((e) => s.roads[e] === p);
}

export function settlementSpots(s: GameState, p: number, setup = false): string[] {
  const t = topo(s);
  return t.vertexIds.filter((v) => vertexOpen(s, v) && (setup || touchesOwnRoad(s, p, v)));
}

export function citySpots(s: GameState, p: number): string[] {
  return Object.entries(s.buildings)
    .filter(([, b]) => b.owner === p && b.kind === 'settlement').map(([v]) => v);
}

// A road may extend from a corner the player owns, or from one of their roads
// through a corner that no opponent has built on.
export function roadSpots(s: GameState, p: number): string[] {
  const t = topo(s);
  return t.edgeIds.filter((e) => {
    if (s.roads[e] !== undefined) return false;
    const { a, b } = t.edges[e];
    return [a, b].some((v) => {
      const bld = s.buildings[v];
      if (bld) return bld.owner === p;
      return t.vertices[v].edges.some((e2) => e2 !== e && s.roads[e2] === p);
    });
  });
}

export function setupRoadSpots(s: GameState, p: number): string[] {
  const v = s.setup?.lastVertex;
  if (!v) return [];
  void p;
  return topo(s).vertices[v].edges.filter((e) => s.roads[e] === undefined);
}

// ── Trading ─────────────────────────────────────────────────────────────────

export function tradeRates(s: GameState, p: number): Record<Resource, number> {
  const t = topo(s);
  const rates = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 } as Record<Resource, number>;
  for (const port of s.ports) {
    const { a, b } = t.edges[port.edge];
    if (s.buildings[a]?.owner !== p && s.buildings[b]?.owner !== p) continue;
    if (port.kind === 'any') RESOURCES.forEach((r) => { rates[r] = Math.min(rates[r], 3); });
    else rates[port.kind] = 2;
  }
  return rates;
}

// ── Robber ──────────────────────────────────────────────────────────────────

export function playersOnHex(s: GameState, hex: number): number[] {
  const owners = new Set<number>();
  for (const v of topo(s).hexCorners[hex]) {
    const b = s.buildings[v];
    if (b) owners.add(b.owner);
  }
  return [...owners].sort();
}

export function stealTargets(s: GameState, hex: number, thief: number): number[] {
  return playersOnHex(s, hex).filter((p) => p !== thief && handSize(s.players[p].hand) > 0);
}

export function robberSpots(s: GameState, p: number): number[] {
  const all = s.hexes.map((_, i) => i).filter((i) => i !== s.robber);
  if (!s.config.friendlyRobber) return all;
  // Friendly robber: leave players with 2 or fewer visible points alone.
  const kind = all.filter((i) => playersOnHex(s, i).every((o) => o === p || publicVP(s, o) > 2));
  return kind.length ? kind : all;
}

// ── Points ──────────────────────────────────────────────────────────────────

export function publicVP(s: GameState, p: number): number {
  let vp = 0;
  for (const b of Object.values(s.buildings)) if (b.owner === p) vp += b.kind === 'city' ? 2 : 1;
  if (s.longestRoad.holder === p) vp += 2;
  if (s.largestArmy.holder === p) vp += 2;
  return vp;
}

export function totalVP(s: GameState, p: number): number {
  return publicVP(s, p) + s.players[p].devCards.filter((c) => c.kind === 'victory').length;
}

// ── Longest road ────────────────────────────────────────────────────────────

// Longest simple trail through the player's roads. A trail may not pass
// through a corner occupied by someone else's building.
export function longestRoadOf(s: GameState, p: number): number {
  const t = topo(s);
  const mine = t.edgeIds.filter((e) => s.roads[e] === p);
  if (!mine.length) return 0;
  let best = 0;
  const used = new Set<string>();
  const blocked = (v: string) => {
    const b = s.buildings[v];
    return !!b && b.owner !== p;
  };
  const walk = (v: string, len: number) => {
    if (len > best) best = len;
    if (blocked(v)) return;
    for (const e of t.vertices[v].edges) {
      if (used.has(e) || s.roads[e] !== p) continue;
      used.add(e);
      const { a, b } = t.edges[e];
      walk(a === v ? b : a, len + 1);
      used.delete(e);
    }
  };
  for (const e of mine) {
    const { a, b } = t.edges[e];
    used.add(e);
    walk(a, 1);
    walk(b, 1);
    used.delete(e);
  }
  return best;
}

// ── Production odds (for hints and the AI) ──────────────────────────────────

export function vertexPips(s: GameState, v: string): number {
  return topo(s).vertices[v].hexes.reduce((n, h) => n + (PIPS[s.hexes[h].number ?? 0] ?? 0), 0);
}

export function vertexResources(s: GameState, v: string): Resource[] {
  return topo(s).vertices[v].hexes.map((h) => s.hexes[h].terrain).filter((t): t is Resource => t !== 'desert');
}

export function canBuild(s: GameState, p: number, what: Buildable): boolean {
  if (s.phase !== 'main' || s.current !== p) return false;
  const pl = s.players[p];
  if (!canAfford(pl.hand, COST[what])) return false;
  const left = piecesLeft(s, p);
  switch (what) {
    case 'road': return left.road > 0 && roadSpots(s, p).length > 0;
    case 'settlement': return left.settlement > 0 && settlementSpots(s, p).length > 0;
    case 'city': return left.city > 0 && citySpots(s, p).length > 0;
    case 'dev': return s.devDeck.length > 0;
  }
}

export function playableDev(s: GameState, p: number): DevKind[] {
  if (s.current !== p || s.devPlayedThisTurn) return [];
  if (s.phase !== 'main' && s.phase !== 'roll') return [];
  const kinds = new Set<DevKind>();
  for (const c of s.players[p].devCards) {
    if (c.kind === 'victory' || c.boughtTurn === s.turn) continue;
    if (s.phase === 'roll' && c.kind !== 'knight') continue;
    kinds.add(c.kind);
  }
  return [...kinds];
}
