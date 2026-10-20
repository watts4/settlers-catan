// Computer players. `chooseAction` looks at the state and returns the single
// next move for a player (or null if it's waiting on someone else), so the
// screen can play AI turns one step at a time with a pause between moves.

import type { Action, GameState, Hand, PartialHand, Resource } from './types';
import { RESOURCES } from './types';
import { PIPS } from './board';
import {
  COST, canAfford, citySpots, handSize, longestRoadOf, piecesLeft, playableDev, publicVP, roadSpots,
  robberSpots, settlementSpots, setupRoadSpots, stealTargets, topo, totalVP, tradeRates, vertexOpen,
} from './rules';
import { makeRng } from './rng';

type Goal = 'city' | 'settlement' | 'road' | 'dev';

// How much of each resource the island makes, so rare ones are worth more.
function scarcity(s: GameState): Record<Resource, number> {
  const pips: Record<Resource, number> = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  s.hexes.forEach((h) => { if (h.terrain !== 'desert') pips[h.terrain] += PIPS[h.number ?? 0] ?? 0; });
  const avg = RESOURCES.reduce((a, r) => a + pips[r], 0) / 5;
  const out = {} as Record<Resource, number>;
  RESOURCES.forEach((r) => { out[r] = Math.min(2, Math.max(0.6, avg / Math.max(1, pips[r]))); });
  return out;
}

// Expected cards per roll of each resource for a player.
function income(s: GameState, p: number): Record<Resource, number> {
  const t = topo(s);
  const inc: Record<Resource, number> = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  for (const [v, b] of Object.entries(s.buildings)) {
    if (b.owner !== p) continue;
    for (const h of t.vertices[v].hexes) {
      const hex = s.hexes[h];
      if (hex.terrain === 'desert' || h === s.robber) continue;
      inc[hex.terrain] += ((PIPS[hex.number ?? 0] ?? 0) / 36) * (b.kind === 'city' ? 2 : 1);
    }
  }
  return inc;
}

// Value of building a settlement on corner v for player p.
function spotValue(s: GameState, p: number, v: string, early = false): number {
  const t = topo(s);
  const sc = scarcity(s);
  const inc = income(s, p);
  let val = 0;
  const kinds = new Set<Resource>();
  for (const h of t.vertices[v].hexes) {
    const hex = s.hexes[h];
    if (hex.terrain === 'desert') continue;
    const pips = PIPS[hex.number ?? 0] ?? 0;
    const blocked = h === s.robber ? 0.5 : 1;
    // A resource the player barely makes is worth more to them.
    const need = inc[hex.terrain] < 0.1 ? 1.35 : inc[hex.terrain] < 0.25 ? 1.1 : 0.9;
    val += pips * sc[hex.terrain] * need * blocked;
    kinds.add(hex.terrain);
  }
  val += kinds.size * (early ? 1.2 : 0.8);
  // Early on, brick and lumber get you going; later, ore and grain win.
  if (early) {
    for (const r of kinds) if (r === 'wood' || r === 'brick') val += 0.8;
  } else {
    for (const r of kinds) if (r === 'ore' || r === 'wheat') val += 0.6;
  }
  const port = s.ports.find((pt) => t.edges[pt.edge].a === v || t.edges[pt.edge].b === v);
  if (port) {
    if (port.kind === 'any') val += 1.5;
    else val += 1 + inc[port.kind] * 25 + (kinds.has(port.kind) ? 2 : 0);
  }
  return val;
}

function missingFor(hand: Hand, cost: PartialHand): PartialHand {
  const m: PartialHand = {};
  for (const r of RESOURCES) {
    const d = (cost[r] ?? 0) - hand[r];
    if (d > 0) m[r] = d;
  }
  return m;
}

// Best corner reachable by building 1-2 more roads, and the first road to it.
function expansion(s: GameState, p: number): { edge: string; value: number } | null {
  const t = topo(s);
  const starts = roadSpots(s, p);
  let best: { edge: string; value: number } | null = null;
  for (const e of starts) {
    const { a, b } = t.edges[e];
    for (const v of [a, b]) {
      // One road: the far corner itself.
      const own = s.buildings[v]?.owner === p || t.vertices[v].edges.some((x) => x !== e && s.roads[x] === p);
      const tip = own ? (v === a ? b : a) : v;
      if (s.buildings[tip] && s.buildings[tip].owner !== p) continue;
      const cand: { v: string; dist: number }[] = [{ v: tip, dist: 1 }];
      for (const n of t.vertices[tip].adj) {
        const e2 = t.vertices[tip].edges.find((x) => t.edges[x].a === n || t.edges[x].b === n);
        if (e2 && s.roads[e2] === undefined) cand.push({ v: n, dist: 2 });
      }
      for (const c of cand) {
        if (!vertexOpen(s, c.v)) continue;
        const value = spotValue(s, p, c.v) / (c.dist === 1 ? 1 : 1.6);
        if (!best || value > best.value) best = { edge: e, value };
      }
    }
  }
  return best;
}

function pickGoal(s: GameState, p: number): Goal {
  const left = piecesLeft(s, p);
  const hand = s.players[p].hand;
  const settle = left.settlement > 0 ? settlementSpots(s, p) : [];
  const cities = left.city > 0 ? citySpots(s, p) : [];
  if (settle.length) {
    if (cities.length && canAfford(hand, COST.city) && !canAfford(hand, COST.settlement)) return 'city';
    // Strong players upgrade when a city is nearer than a settlement.
    if (s.players[p].aiLevel === 'hard' && cities.length && missingCount(hand, COST.city) < missingCount(hand, COST.settlement)) return 'city';
    return 'settlement';
  }
  if (cities.length && (hand.ore >= 2 || hand.wheat >= 2 || left.settlement === 0)) return 'city';
  if (left.settlement > 0 && left.road > 0 && expansion(s, p)) {
    // No open spot yet: keep roads going unless a city is closer.
    if (cities.length && missingCount(hand, COST.city) <= missingCount(hand, COST.road) + 1) return 'city';
    return 'road';
  }
  if (cities.length) return 'city';
  if (s.devDeck.length) return 'dev';
  return 'road';
}

const missingCount = (h: Hand, cost: PartialHand) => handSize(missingFor(h, cost));

// Cards the player can spare without hurting the goal.
function surplus(hand: Hand, keep: PartialHand): Hand {
  const out = { ...hand };
  for (const r of RESOURCES) out[r] = Math.max(0, hand[r] - (keep[r] ?? 0));
  return out;
}

// How much player p wants one more card of each resource right now.
function wants(s: GameState, p: number): Record<Resource, number> {
  const goal = pickGoal(s, p);
  const hand = s.players[p].hand;
  const miss = missingFor(hand, COST[goal]);
  const sc = scarcity(s);
  const out = {} as Record<Resource, number>;
  for (const r of RESOURCES) {
    let w = sc[r];
    if ((miss[r] ?? 0) > 0) w += 2;
    if (hand[r] >= 3) w -= 0.8;
    if (hand[r] >= 5) w -= 0.8;
    out[r] = w;
  }
  return out;
}

function value(h: PartialHand, w: Record<Resource, number>): number {
  return RESOURCES.reduce((a, r) => a + (h[r] ?? 0) * w[r], 0);
}

// ── decisions ───────────────────────────────────────────────────────────────

export function chooseAction(s: GameState, p: number): Action | null {
  const pl = s.players[p];
  const level = pl.aiLevel;
  const rng = makeRng((s.rng ^ (s.seq * 2654435761) ^ (p * 97)) >>> 0);
  const noisy = level === 'easy';
  // Normal plays the full strategy with a little less care than hard: a bit of
  // randomness in where it settles and how it trades.
  const setupNoise = level === 'easy' ? 4 : level === 'normal' ? 1.6 : 0;

  // Answering someone else's offer.
  if (s.trade && s.trade.from !== p && s.trade.responses[p] === 'pending') {
    return { type: 'respondTrade', player: p, accept: wantsTrade(s, p, s.trade.give, s.trade.get, s.trade.from) };
  }
  if (s.phase === 'discard') {
    const due = s.mustDiscard[p];
    return due ? { type: 'discard', player: p, cards: chooseDiscard(s, p, due) } : null;
  }
  if (s.current !== p) return null;

  switch (s.phase) {
    case 'setup': {
      const st = s.setup!;
      if (st.step === 'settlement') {
        const spots = settlementSpots(s, p, true);
        const scored = spots.map((v) => ({ v, val: spotValue(s, p, v, true) + rng.next() * setupNoise }))
          .sort((a, b) => b.val - a.val);
        return { type: 'placeSettlement', player: p, vertex: scored[0].v };
      }
      const t = topo(s);
      const roads = setupRoadSpots(s, p);
      let best = roads[0], bestVal = -1;
      for (const e of roads) {
        const far = t.edges[e].a === st.lastVertex ? t.edges[e].b : t.edges[e].a;
        let val = 0;
        for (const n of t.vertices[far].adj) if (n !== st.lastVertex && vertexOpen(s, n)) val = Math.max(val, spotValue(s, p, n, true));
        if (val > bestVal) { bestVal = val; best = e; }
      }
      return { type: 'placeRoad', player: p, edge: best };
    }
    case 'roll': {
      if (playableDev(s, p).includes('knight') && shouldKnight(s, p)) return { type: 'playKnight', player: p };
      return { type: 'roll', player: p };
    }
    case 'robber':
      return { type: 'moveRobber', player: p, hex: chooseRobber(s, p, noisy ? rng.next() : 0) };
    case 'steal': {
      const targets = stealTargets(s, s.robber, p)
        .sort((a, b) => totalVPGuess(s, b) - totalVPGuess(s, a) || handSize(s.players[b].hand) - handSize(s.players[a].hand));
      return { type: 'steal', player: p, victim: targets[0] };
    }
    case 'roadBuilding': {
      const exp = expansion(s, p);
      const spots = roadSpots(s, p);
      if (!spots.length) return { type: 'skipRoads', player: p };
      return { type: 'buildRoad', player: p, edge: exp?.edge ?? bestRoadForLength(s, p, spots) };
    }
    case 'main':
      return mainTurn(s, p, rng, noisy);
    default:
      return null;
  }
}

function totalVPGuess(s: GameState, p: number): number {
  // Opponents can't see VP cards; guess a little for hidden cards.
  return publicVP(s, p) + s.players[p].devCards.length * 0.2;
}

function shouldKnight(s: GameState, p: number): boolean {
  const t = topo(s);
  const mine = t.hexCorners[s.robber].some((v) => s.buildings[v]?.owner === p);
  const hex = s.hexes[s.robber];
  const hard = s.players[p].aiLevel === 'hard';
  if (mine && hex.number && (PIPS[hex.number] ?? 0) >= (hard ? 2 : 3)) return true;
  const k = s.players[p].knights + 1;
  if (k >= 3 && s.largestArmy.holder !== p && k > s.largestArmy.size) return true;
  return false;
}

function chooseRobber(s: GameState, p: number, noise: number): number {
  const t = topo(s);
  const spots = robberSpots(s, p);
  let best = spots[0], bestVal = -Infinity;
  for (const h of spots) {
    const hex = s.hexes[h];
    const pips = PIPS[hex.number ?? 0] ?? 0;
    let val = 0;
    for (const v of t.hexCorners[h]) {
      const b = s.buildings[v];
      if (!b) continue;
      const mult = b.kind === 'city' ? 2 : 1;
      if (b.owner === p) val -= 8 * mult * (pips / 3);
      else {
        const vp = totalVPGuess(s, b.owner);
        val += pips * mult * (1 + vp / 5);
        if (handSize(s.players[b.owner].hand) > 0) val += 1;
      }
    }
    val += noise * 3 * Math.random();
    if (val > bestVal) { bestVal = val; best = h; }
  }
  return best;
}

function chooseDiscard(s: GameState, p: number, n: number): PartialHand {
  const hand = { ...s.players[p].hand };
  const w = wants(s, p);
  const out: PartialHand = {};
  for (let i = 0; i < n; i++) {
    // Drop the card we'd miss least: lowest want, then whatever we have most of.
    let pick: Resource | null = null;
    for (const r of RESOURCES) {
      if (hand[r] <= 0) continue;
      if (!pick || w[r] - hand[r] * 0.3 < w[pick] - hand[pick] * 0.3) pick = r;
    }
    if (!pick) break;
    hand[pick]--;
    out[pick] = (out[pick] ?? 0) + 1;
  }
  return out;
}

function wantsTrade(s: GameState, p: number, theyGive: PartialHand, theyGet: PartialHand, from: number): boolean {
  const hand = s.players[p].hand;
  if (!RESOURCES.every((r) => hand[r] >= (theyGet[r] ?? 0))) return false;
  // Don't feed someone who's about to win.
  const level = s.players[p].aiLevel;
  if (publicVP(s, from) >= s.config.vpToWin - (level === 'hard' ? 3 : 2)) return false;
  const w = wants(s, p);
  const gain = value(theyGive, w), loss = value(theyGet, w);
  const margin = level === 'hard' ? 0.3 : level === 'easy' ? -0.3 : 0.2;
  return gain - loss > margin;
}

function bestRoadForLength(s: GameState, p: number, spots: string[]): string {
  let best = spots[0], bestLen = -1;
  for (const e of spots) {
    const trial: GameState = { ...s, roads: { ...s.roads, [e]: p } };
    const len = longestRoadOf(trial, p);
    if (len > bestLen) { bestLen = len; best = e; }
  }
  return best;
}

function mainTurn(s: GameState, p: number, rng: ReturnType<typeof makeRng>, noisy: boolean): Action {
  const pl = s.players[p];
  const hand = pl.hand;
  const level = pl.aiLevel;

  // Our own offer is out: take the best acceptance once everyone has answered.
  if (s.trade && s.trade.from === p) {
    const r = s.trade.responses;
    const accepted = Object.keys(r).filter((k) => r[k] === 'accept').map(Number);
    if (accepted.length) {
      accepted.sort((a, b) => publicVP(s, a) - publicVP(s, b));
      return { type: 'acceptTrade', player: p, partner: accepted[0] };
    }
    if (Object.values(r).every((v) => v !== 'pending')) return { type: 'cancelTrade', player: p };
    return { type: 'cancelTrade', player: p }; // driver only asks once others have answered or timed out
  }

  // Development cards first: they can unlock a build this turn.
  const playable = playableDev(s, p);
  if (playable.includes('knight') && shouldKnight(s, p)) return { type: 'playKnight', player: p };
  const goal = pickGoal(s, p);
  const miss = missingFor(hand, COST[goal]);
  if (playable.includes('monopoly')) {
    let bestR: Resource | null = null, bestN = 0;
    for (const r of RESOURCES) {
      const n = s.players.reduce((a, o, i) => a + (i === p ? 0 : o.hand[r]), 0);
      const useful = (miss[r] ?? 0) > 0 ? n * 1.5 : n * 0.7;
      if (useful > bestN) { bestN = useful; bestR = r; }
    }
    if (bestR && bestN >= 4) return { type: 'playMonopoly', player: p, res: bestR };
  }
  if (playable.includes('yearOfPlenty') && handSize(miss) > 0 && handSize(miss) <= 2) {
    const take: PartialHand = { ...miss };
    if (handSize(take) === 1) {
      const extra = goal === 'city' ? 'ore' : 'wheat';
      take[extra] = (take[extra] ?? 0) + 1;
    }
    if (RESOURCES.every((r) => s.bank[r] >= (take[r] ?? 0))) return { type: 'playYearOfPlenty', player: p, take };
  }
  if (playable.includes('roadBuilding') && piecesLeft(s, p).road >= 1 && (goal === 'road' || settlementSpots(s, p).length === 0) && roadSpots(s, p).length) {
    return { type: 'playRoadBuilding', player: p };
  }

  // Build whatever we can afford, best goal first.
  const order: Goal[] = [goal, 'city', 'settlement', 'dev', 'road'];
  for (const g of order) {
    const act = tryBuild(s, p, g, goal);
    if (act) return act;
  }

  // Trade toward the goal with the bank or a harbour.
  if (!(noisy && rng.next() < 0.3) && !(level === 'normal' && rng.next() < 0.15)) {
    const bank = bankTradeToward(s, p, COST[goal]);
    if (bank) return bank;
  }

  // Ask the table for a missing card, at most twice a turn.
  if (level !== 'easy' && s.tradesThisTurn < 1 && handSize(miss) > 0 && handSize(miss) <= 2) {
    const spare = surplus(hand, COST[goal]);
    const giveR = RESOURCES.filter((r) => spare[r] > 0).sort((a, b) => spare[b] - spare[a])[0];
    const getR = RESOURCES.find((r) => (miss[r] ?? 0) > 0);
    if (giveR && getR) {
      const giveN = spare[giveR] >= 3 && s.tradesThisTurn === 1 ? 2 : 1;
      return { type: 'offerTrade', player: p, give: { [giveR]: giveN }, get: { [getR]: 1 } };
    }
  }

  // Holding a lot of cards with a seven coming: spend some.
  if (handSize(hand) > 7) {
    for (const g of ['dev', 'road', 'settlement', 'city'] as Goal[]) {
      const act = tryBuild(s, p, g, goal, true);
      if (act) return act;
    }
    const bank = bankTradeToward(s, p, COST.dev) ?? bankTradeToward(s, p, COST.city);
    if (bank) return bank;
  }
  return { type: 'endTurn', player: p };
}

function tryBuild(s: GameState, p: number, g: Goal, goal: Goal, force = false): Action | null {
  const hand = s.players[p].hand;
  if (!canAfford(hand, COST[g])) return null;
  const left = piecesLeft(s, p);
  switch (g) {
    case 'city': {
      if (left.city <= 0) return null;
      const spots = citySpots(s, p);
      if (!spots.length) return null;
      spots.sort((a, b) => spotValue(s, p, b) - spotValue(s, p, a));
      return { type: 'buildCity', player: p, vertex: spots[0] };
    }
    case 'settlement': {
      if (left.settlement <= 0) return null;
      const spots = settlementSpots(s, p);
      if (!spots.length) return null;
      spots.sort((a, b) => spotValue(s, p, b) - spotValue(s, p, a));
      return { type: 'buildSettlement', player: p, vertex: spots[0] };
    }
    case 'dev': {
      if (!s.devDeck.length) return null;
      // Don't spend city/settlement cards on a gamble unless it's the plan.
      if (!force && goal !== 'dev' && (goal === 'city' || goal === 'settlement')) {
        const after = { ...hand, sheep: hand.sheep - 1, wheat: hand.wheat - 1, ore: hand.ore - 1 };
        if (missingCount(after, COST[goal]) > missingCount(hand, COST[goal])) return null;
      }
      return { type: 'buyDev', player: p };
    }
    case 'road': {
      if (left.road <= 0) return null;
      const spots = roadSpots(s, p);
      if (!spots.length) return null;
      // Roads only when they lead somewhere, chase Longest Road, or we must spend.
      const exp = expansion(s, p);
      if (exp && (goal === 'road' || force || settlementSpots(s, p).length === 0)) {
        return { type: 'buildRoad', player: p, edge: exp.edge };
      }
      const mine = longestRoadOf(s, p);
      const holder = s.longestRoad.holder;
      const target = holder === null ? 5 : s.longestRoad.length + 1;
      if ((holder !== p && mine + 2 >= target && left.road >= 2) || force) {
        if (goal === 'settlement' || goal === 'city') {
          // Only if it doesn't eat cards the goal needs.
          const after = { ...hand, wood: hand.wood - 1, brick: hand.brick - 1 };
          if (missingCount(after, COST[goal]) > missingCount(hand, COST[goal]) && !force) return null;
        }
        return { type: 'buildRoad', player: p, edge: bestRoadForLength(s, p, spots) };
      }
      return null;
    }
  }
}

function bankTradeToward(s: GameState, p: number, cost: PartialHand): Action | null {
  const hand = s.players[p].hand;
  const miss = missingFor(hand, cost);
  const need = RESOURCES.find((r) => (miss[r] ?? 0) > 0 && s.bank[r] > 0);
  if (!need) return null;
  const rates = tradeRates(s, p);
  const spare = surplus(hand, cost);
  // Only trade if the whole goal becomes reachable this turn. Strong players
  // also trade part of the way when a big hand is at risk from a seven.
  let budget = 0;
  for (const r of RESOURCES) budget += Math.floor(spare[r] / rates[r]);
  const risky = s.players[p].aiLevel === 'hard' && handSize(hand) >= 7;
  if (budget < handSize(miss) && !(risky && budget >= 1)) return null;
  const give = RESOURCES.filter((r) => spare[r] >= rates[r])
    .sort((a, b) => spare[b] / rates[b] - spare[a] / rates[a])[0];
  if (!give) return null;
  return { type: 'bankTrade', player: p, give, get: need };
}

// Safe fallback when the planned move is rejected: something always legal.
export function fallbackAction(s: GameState, p: number): Action | null {
  if (s.trade && s.trade.from !== p && s.trade.responses[p] === 'pending') return { type: 'respondTrade', player: p, accept: false };
  if (s.phase === 'discard' && s.mustDiscard[p]) {
    const hand = { ...s.players[p].hand };
    const cards: PartialHand = {};
    for (let i = 0; i < s.mustDiscard[p]; i++) {
      const r = RESOURCES.filter((x) => hand[x] > 0).sort((a, b) => hand[b] - hand[a])[0];
      hand[r]--; cards[r] = (cards[r] ?? 0) + 1;
    }
    return { type: 'discard', player: p, cards };
  }
  if (s.current !== p) return null;
  switch (s.phase) {
    case 'setup':
      return s.setup!.step === 'settlement'
        ? { type: 'placeSettlement', player: p, vertex: settlementSpots(s, p, true)[0] }
        : { type: 'placeRoad', player: p, edge: setupRoadSpots(s, p)[0] };
    case 'roll': return { type: 'roll', player: p };
    case 'robber': return { type: 'moveRobber', player: p, hex: robberSpots(s, p)[0] };
    case 'steal': return { type: 'steal', player: p, victim: stealTargets(s, s.robber, p)[0] };
    case 'roadBuilding': return { type: 'skipRoads', player: p };
    case 'main': return s.trade ? { type: 'cancelTrade', player: p } : { type: 'endTurn', player: p };
    default: return null;
  }
}

export { totalVP };
