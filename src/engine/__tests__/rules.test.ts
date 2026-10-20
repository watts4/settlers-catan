import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../game';
import type { Action, GameState } from '../types';
import { citySpots, longestRoadOf, roadSpots, settlementSpots, topo, totalVP, tradeRates } from '../rules';

function fresh(players = 4): GameState {
  const s = createGame({ seed: 123, firstPlayer: 0, players: Array.from({ length: players }, (_, i) => ({ name: `P${i}`, controller: 'human' as const })) });
  // Skip setup: straight into player 0's main phase with an empty board.
  s.phase = 'main';
  s.setup = null;
  s.turn = 1;
  s.current = 0;
  return s;
}

function act(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function err(s: GameState, a: Action): string {
  const r = applyAction(s, a);
  if (r.ok) throw new Error('expected rejection');
  return r.error;
}

function give(s: GameState, p: number, hand: Partial<Record<'wood' | 'brick' | 'sheep' | 'wheat' | 'ore', number>>) {
  for (const [r, n] of Object.entries(hand)) {
    s.players[p].hand[r as 'wood'] += n!;
    s.bank[r as 'wood'] -= n!;
  }
}

// A straight-ish path of corners: walk from a corner along unused edges.
function path(s: GameState, start: string, len: number): string[] {
  const t = topo(s);
  const edges: string[] = [];
  const seen = new Set([start]);
  let v = start;
  for (let i = 0; i < len; i++) {
    const e = t.vertices[v].edges.find((x) => {
      const o = t.edges[x].a === v ? t.edges[x].b : t.edges[x].a;
      return !seen.has(o);
    })!;
    edges.push(e);
    v = t.edges[e].a === v ? t.edges[e].b : t.edges[e].a;
    seen.add(v);
  }
  return edges;
}

describe('setup', () => {
  it('snakes the order and pays out the second settlement', () => {
    let s = createGame({ seed: 5, firstPlayer: 1, players: ['A', 'B', 'C'].map((name) => ({ name, controller: 'human' as const })) });
    expect(s.setup!.order).toEqual([1, 2, 0, 0, 2, 1]);
    const t = topo(s);
    for (let i = 0; i < 6; i++) {
      const p = s.current;
      const v = settlementSpots(s, p, true).find((x) => t.vertices[x].hexes.length === 3)!;
      s = act(s, { type: 'placeSettlement', player: p, vertex: v });
      if (i >= 3) {
        const cards = Object.values(s.players[p].hand).reduce((a, b) => a + b, 0);
        const land = t.vertices[v].hexes.filter((h) => s.hexes[h].terrain !== 'desert').length;
        expect(cards).toBe(land);
      }
      s = act(s, { type: 'placeRoad', player: p, edge: t.vertices[v].edges[0] });
    }
    expect(s.phase).toBe('roll');
    expect(s.current).toBe(1);
  });

  it('enforces the distance rule', () => {
    const s = createGame({ seed: 9, firstPlayer: 0, players: [{ name: 'A', controller: 'human' }, { name: 'B', controller: 'human' }, { name: 'C', controller: 'human' }] });
    const t = topo(s);
    const v = t.vertexIds[20];
    const s2 = act(s, { type: 'placeSettlement', player: 0, vertex: v });
    expect(settlementSpots(s2, 1, true)).not.toContain(t.vertices[v].adj[0]);
  });
});

describe('building', () => {
  it('needs connection, the right cards, and pays the bank', () => {
    let s = fresh();
    const t = topo(s);
    const v = t.vertexIds[25];
    s.buildings[v] = { owner: 0, kind: 'settlement' };
    expect(err(s, { type: 'buildRoad', player: 0, edge: t.vertices[v].edges[0] })).toMatch(/costs/);
    give(s, 0, { wood: 1, brick: 1 });
    const far = t.edgeIds.find((e) => !t.vertices[v].edges.includes(e) && t.edges[e].a !== v)!;
    expect(err(s, { type: 'buildRoad', player: 0, edge: far })).toMatch(/connect/);
    s = act(s, { type: 'buildRoad', player: 0, edge: t.vertices[v].edges[0] });
    expect(s.players[0].hand.wood).toBe(0);
    expect(s.bank.wood).toBe(19);
  });

  it('cities replace your own settlements only', () => {
    let s = fresh();
    const t = topo(s);
    s.buildings[t.vertexIds[10]] = { owner: 1, kind: 'settlement' };
    s.buildings[t.vertexIds[30]] = { owner: 0, kind: 'settlement' };
    give(s, 0, { wheat: 2, ore: 3 });
    expect(citySpots(s, 0)).toEqual([t.vertexIds[30]]);
    expect(err(s, { type: 'buildCity', player: 0, vertex: t.vertexIds[10] })).toMatch(/replace/);
    s = act(s, { type: 'buildCity', player: 0, vertex: t.vertexIds[30] });
    expect(totalVP(s, 0)).toBe(2);
  });

  it('roads cannot pass through an opponent\'s settlement', () => {
    const s = fresh();
    const t = topo(s);
    const [e1, e2] = path(s, t.vertexIds[24], 2);
    s.roads[e1] = 0;
    const mid = t.edges[e1].a === t.vertexIds[24] ? t.edges[e1].b : t.edges[e1].a;
    s.buildings[mid] = { owner: 1, kind: 'settlement' };
    expect(roadSpots(s, 0)).not.toContain(e2);
  });
});

describe('longest road', () => {
  it('needs five, goes to the longest, and breaks when cut', () => {
    let s = fresh();
    const t = topo(s);
    const start = t.vertexIds[0];
    const edges = path(s, start, 6);
    s.buildings[start] = { owner: 0, kind: 'settlement' };
    edges.slice(0, 4).forEach((e) => { s.roads[e] = 0; });
    give(s, 0, { wood: 2, brick: 2 });
    s = act(s, { type: 'buildRoad', player: 0, edge: edges[4] });
    expect(longestRoadOf(s, 0)).toBe(5);
    expect(s.longestRoad.holder).toBe(0);
    expect(totalVP(s, 0)).toBe(3);

    // Player 1 builds a settlement in the middle of the road: it splits 2 + 3.
    let mid = start;
    for (let i = 0; i < 2; i++) { const e = t.edges[edges[i]]; mid = e.a === mid ? e.b : e.a; }
    s.current = 1;
    const p1Road = t.vertices[mid].edges.find((e) => !edges.includes(e))!;
    s.roads[p1Road] = 1;
    // clear the distance rule around mid for the test
    give(s, 1, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
    s = act(s, { type: 'buildSettlement', player: 1, vertex: mid });
    expect(longestRoadOf(s, 0)).toBe(3);
    expect(s.longestRoad.holder).toBe(null);
  });
});

describe('the seven', () => {
  it('makes big hands discard half, then the robber steals', () => {
    let s = fresh();
    s.phase = 'roll';
    give(s, 1, { wood: 5, brick: 4 });   // 9 cards: discards 4
    give(s, 2, { ore: 7 });              // 7 cards: safe
    // Find a seed state that rolls a seven.
    for (let i = 0; i < 500; i++) {
      s.rng = i;
      const r = applyAction(s, { type: 'roll', player: 0 });
      if (r.ok && r.state.dice!.a + r.state.dice!.b === 7) { s = r.state; break; }
    }
    expect(s.phase).toBe('discard');
    expect(s.mustDiscard).toEqual({ 1: 4 });
    expect(err(s, { type: 'discard', player: 1, cards: { wood: 3 } })).toMatch(/exactly 4/);
    s = act(s, { type: 'discard', player: 1, cards: { wood: 2, brick: 2 } });
    expect(s.phase).toBe('robber');
    expect(err(s, { type: 'moveRobber', player: 0, hex: s.robber })).toMatch(/somewhere else/);
    const t = topo(s);
    const hex = s.robber === 0 ? 1 : 0;
    s.buildings[t.hexCorners[hex][0]] = { owner: 1, kind: 'settlement' };
    s = act(s, { type: 'moveRobber', player: 0, hex });
    expect(s.phase).toBe('main');
    expect(Object.values(s.players[0].hand).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('development cards', () => {
  it('waits a turn, one per turn, and knights win Largest Army at three', () => {
    let s = fresh();
    give(s, 0, { sheep: 1, wheat: 1, ore: 1 });
    s.devDeck.push('knight');
    s = act(s, { type: 'buyDev', player: 0 });
    expect(err(s, { type: 'playKnight', player: 0 })).toMatch(/next turn/);
    s.players[0].devCards = [{ kind: 'knight', boughtTurn: 0 }, { kind: 'knight', boughtTurn: 0 }, { kind: 'knight', boughtTurn: 0 }];
    s.devDeck.splice(s.devDeck.length - 0, 0);
    s = act(s, { type: 'playKnight', player: 0 });
    expect(s.phase).toBe('robber');
    s = act(s, { type: 'moveRobber', player: 0, hex: s.robber === 0 ? 1 : 0 });
    expect(err(s, { type: 'playKnight', player: 0 })).toMatch(/one development card/);
    s.devPlayedThisTurn = false;
    s = act(s, { type: 'playKnight', player: 0 });
    s = act(s, { type: 'moveRobber', player: 0, hex: s.robber === 0 ? 1 : 0 });
    s.devPlayedThisTurn = false;
    s = act(s, { type: 'playKnight', player: 0 });
    expect(s.largestArmy.holder).toBe(0);
  });

  it('monopoly takes every card of one kind', () => {
    let s = fresh();
    give(s, 1, { wheat: 3 });
    give(s, 2, { wheat: 2, ore: 1 });
    s.players[0].devCards = [{ kind: 'monopoly', boughtTurn: 0 }];
    s = act(s, { type: 'playMonopoly', player: 0, res: 'wheat' });
    expect(s.players[0].hand.wheat).toBe(5);
    expect(s.players[1].hand.wheat + s.players[2].hand.wheat).toBe(0);
  });

  it('a knight may be played before rolling and returns to the roll', () => {
    let s = fresh();
    s.phase = 'roll';
    s.players[0].devCards = [{ kind: 'knight', boughtTurn: 0 }];
    s = act(s, { type: 'playKnight', player: 0 });
    s = act(s, { type: 'moveRobber', player: 0, hex: s.robber === 0 ? 1 : 0 });
    expect(s.phase).toBe('roll');
  });
});

describe('trading', () => {
  it('uses harbour rates', () => {
    const s = fresh();
    const port = s.ports.find((p) => p.kind !== 'any')!;
    const e = topo(s).edges[port.edge];
    s.buildings[e.a] = { owner: 0, kind: 'settlement' };
    const rates = tradeRates(s, 0);
    expect(rates[port.kind as 'wood']).toBe(2);
  });

  it('runs an offer: accept, then the offerer picks a partner', () => {
    let s = fresh();
    give(s, 0, { wood: 2 });
    give(s, 2, { ore: 1 });
    s = act(s, { type: 'offerTrade', player: 0, give: { wood: 1 }, get: { ore: 1 } });
    expect(err(s, { type: 'respondTrade', player: 1, accept: true })).toMatch(/don't have/);
    s = act(s, { type: 'respondTrade', player: 2, accept: true });
    s = act(s, { type: 'acceptTrade', player: 0, partner: 2 });
    expect(s.players[0].hand).toMatchObject({ wood: 1, ore: 1 });
    expect(s.players[2].hand).toMatchObject({ wood: 1, ore: 0 });
    expect(s.trade).toBeNull();
  });
});

describe('winning', () => {
  it('only happens on your own turn', () => {
    let s = fresh();
    const t = topo(s);
    // Player 1 sits on 9 points plus a hidden VP card, off turn.
    const spots = t.vertexIds.filter((_, i) => i % 7 === 0).slice(0, 5);
    spots.forEach((v, i) => { s.buildings[v] = { owner: 1, kind: i < 4 ? 'city' : 'settlement' }; });
    s.players[1].devCards = [{ kind: 'victory', boughtTurn: 0 }];
    expect(totalVP(s, 1)).toBe(10);
    expect(s.winner).toBeNull();
    s = act(s, { type: 'endTurn', player: 0 });
    expect(s.winner).toBe(1);
    expect(s.phase).toBe('gameOver');
  });
});
