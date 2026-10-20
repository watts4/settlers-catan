// The rules engine. `createGame` deals a new game and `applyAction` takes one
// move and returns the next state, or an error saying why the move isn't
// allowed. Nothing here touches the screen, the network or Math.random.

import type {
  Action, AiLevel, Controller, DevKind, GameEvent, GameState, Hand, PartialHand, Player, Resource,
} from './types';
import { RESOURCES } from './types';
import { generateIsland, resourceOf } from './board';
import { makeRng, randomSeed } from './rng';
import {
  BANK_SIZE, COST, DEV_DECK, canAfford, citySpots, emptyHand, handSize, longestRoadOf, piecesLeft,
  publicVP, roadSpots, robberSpots, settlementSpots, setupRoadSpots, stealTargets, topo, totalVP, tradeRates,
} from './rules';

export const PLAYER_COLORS = ['#d23c2f', '#2f6fd2', '#f2efe6', '#e8892b', '#3f9b4a', '#8b5a2b'];
export const COLOR_NAMES = ['Red', 'Blue', 'White', 'Orange', 'Green', 'Brown'];

export interface PlayerSetup {
  name: string;
  controller: Controller;
  aiLevel?: AiLevel;
  color?: string;
}

export interface GameOptions {
  players: PlayerSetup[];
  seed?: number;
  vpToWin?: number;
  friendlyRobber?: boolean;
  firstPlayer?: number; // default: random
}

export type Result = { ok: true; state: GameState } | { ok: false; error: string };

export function createGame(opts: GameOptions): GameState {
  const seed = opts.seed ?? randomSeed();
  const rng = makeRng(seed);
  const { hexes, ports, robber } = generateIsland(rng);
  const n = opts.players.length;
  const first = opts.firstPlayer ?? rng.int(n);
  const seats = Array.from({ length: n }, (_, i) => (first + i) % n);
  const players: Player[] = opts.players.map((p, i) => ({
    name: p.name,
    color: p.color ?? PLAYER_COLORS[i],
    controller: p.controller,
    aiLevel: p.aiLevel ?? 'normal',
    hand: emptyHand(),
    devCards: [],
    knights: 0,
    stats: { roadsBuilt: 0, settlementsBuilt: 0, citiesBuilt: 0, devBought: 0, devPlayed: 0, resourcesGained: 0, stolen: 0, timesRobbed: 0, trades: 0 },
  }));
  const s: GameState = {
    schema: 2,
    id: `g${seed.toString(36)}${Date.now().toString(36)}`,
    rng: 0,
    config: { vpToWin: opts.vpToWin ?? 10, friendlyRobber: opts.friendlyRobber ?? false },
    hexes, ports, robber,
    buildings: {},
    roads: {},
    players,
    bank: { wood: BANK_SIZE, brick: BANK_SIZE, sheep: BANK_SIZE, wheat: BANK_SIZE, ore: BANK_SIZE },
    devDeck: rng.shuffle([...DEV_DECK]),
    turn: 0,
    current: first,
    phase: 'setup',
    setup: { order: [...seats, ...[...seats].reverse()], index: 0, step: 'settlement', lastVertex: null },
    dice: null,
    devPlayedThisTurn: false,
    freeRoads: 0,
    afterRobber: 'main',
    mustDiscard: {},
    longestRoad: { holder: null, length: 0 },
    largestArmy: { holder: null, size: 0 },
    trade: null,
    tradesThisTurn: 0,
    winner: null,
    log: [],
    events: [],
    seq: 0,
  };
  s.rng = rng.state();
  log(s, null, `${players[first].name} goes first.`);
  return s;
}

// ── helpers ─────────────────────────────────────────────────────────────────

const NAMES: Record<Resource, string> = { wood: 'lumber', brick: 'brick', sheep: 'wool', wheat: 'grain', ore: 'ore' };
export const resName = (r: Resource) => NAMES[r];
export const DEV_NAMES: Record<DevKind, string> = {
  knight: 'Knight', victory: 'Victory Point', roadBuilding: 'Road Building', yearOfPlenty: 'Year of Plenty', monopoly: 'Monopoly',
};

function handText(h: PartialHand): string {
  return RESOURCES.filter((r) => (h[r] ?? 0) > 0).map((r) => `${h[r]} ${NAMES[r]}`).join(', ') || 'nothing';
}

function log(s: GameState, player: number | null, text: string) {
  s.log.push({ turn: s.turn, player, text });
  if (s.log.length > 250) s.log.splice(0, s.log.length - 250);
}

type EventInput = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, 'seq'> : never) : never;
function emit(s: GameState, e: EventInput) {
  s.seq += 1;
  s.events.push({ ...e, seq: s.seq } as GameEvent);
  if (s.events.length > 40) s.events.splice(0, s.events.length - 40);
}

function pay(s: GameState, p: number, cost: PartialHand) {
  for (const r of RESOURCES) {
    const n = cost[r] ?? 0;
    s.players[p].hand[r] -= n;
    s.bank[r] += n;
  }
}

function validHand(h: PartialHand): boolean {
  return Object.entries(h).every(([k, v]) => (RESOURCES as readonly string[]).includes(k) && Number.isInteger(v) && (v as number) >= 0);
}

function hasCards(hand: Hand, h: PartialHand): boolean {
  return RESOURCES.every((r) => hand[r] >= (h[r] ?? 0));
}

function rollDie(s: GameState): number {
  const rng = makeRng(s.rng);
  const v = rng.int(6) + 1;
  s.rng = rng.state();
  return v;
}

function randomInt(s: GameState, n: number): number {
  const rng = makeRng(s.rng);
  const v = rng.int(n);
  s.rng = rng.state();
  return v;
}

// Recompute Longest Road after any road or settlement change. The holder keeps
// it on a tie; if their road is cut and others tie for the lead, nobody has it.
function updateLongestRoad(s: GameState) {
  const lengths = s.players.map((_, p) => longestRoadOf(s, p));
  const prev = s.longestRoad.holder;
  const max = Math.max(...lengths);
  let holder: number | null = prev;
  if (prev !== null && lengths[prev] >= 5 && lengths[prev] === max) {
    holder = prev;
  } else if (max >= 5) {
    const leaders = lengths.map((l, i) => (l === max ? i : -1)).filter((i) => i >= 0);
    holder = leaders.length === 1 ? leaders[0] : null;
  } else {
    holder = null;
  }
  s.longestRoad = { holder, length: holder === null ? 0 : lengths[holder] };
  if (holder !== prev) {
    emit(s, { kind: 'award', player: holder, award: 'longestRoad' });
    log(s, holder, holder === null
      ? 'Nobody holds Longest Road now.'
      : `${s.players[holder].name} takes Longest Road (${lengths[holder]}).`);
  }
}

function updateLargestArmy(s: GameState, p: number) {
  const k = s.players[p].knights;
  if (k < 3 || s.largestArmy.holder === p) {
    if (s.largestArmy.holder === p) s.largestArmy.size = k;
    return;
  }
  if (k > s.largestArmy.size) {
    s.largestArmy = { holder: p, size: k };
    emit(s, { kind: 'award', player: p, award: 'largestArmy' });
    log(s, p, `${s.players[p].name} takes Largest Army (${k} knights).`);
  }
}

function checkWin(s: GameState) {
  const p = s.current;
  if (s.phase === 'setup' || s.winner !== null) return;
  if (totalVP(s, p) >= s.config.vpToWin) {
    s.winner = p;
    s.phase = 'gameOver';
    s.trade = null;
    emit(s, { kind: 'win', player: p });
    log(s, p, `🏆 ${s.players[p].name} wins with ${totalVP(s, p)} points!`);
  }
}

function produce(s: GameState, sum: number) {
  const t = topo(s);
  // Work out everyone's claim first: if the bank can't cover every claim on a
  // resource, nobody gets it unless only one player is owed.
  const claims: Record<Resource, { player: number; hex: number; n: number }[]> = { wood: [], brick: [], sheep: [], wheat: [], ore: [] };
  s.hexes.forEach((h, i) => {
    if (h.number !== sum || i === s.robber) return;
    const res = resourceOf(h.terrain);
    if (!res) return;
    for (const v of t.hexCorners[i]) {
      const b = s.buildings[v];
      if (b) claims[res].push({ player: b.owner, hex: i, n: b.kind === 'city' ? 2 : 1 });
    }
  });
  const gains: { player: number; hex: number; res: Resource; n: number }[] = [];
  for (const res of RESOURCES) {
    const list = claims[res];
    if (!list.length) continue;
    const total = list.reduce((a, c) => a + c.n, 0);
    const owed = new Set(list.map((c) => c.player));
    if (total > s.bank[res]) {
      if (owed.size > 1) {
        log(s, null, `The bank is short of ${NAMES[res]}, so nobody gets any.`);
        continue;
      }
      // One player: they get what's left.
      let left = s.bank[res];
      for (const c of list) {
        const n = Math.min(c.n, left);
        left -= n;
        if (n > 0) gains.push({ player: c.player, hex: c.hex, res, n });
      }
    } else {
      for (const c of list) gains.push({ player: c.player, hex: c.hex, res, n: c.n });
    }
  }
  const byPlayer = new Map<number, PartialHand>();
  for (const g of gains) {
    s.players[g.player].hand[g.res] += g.n;
    s.players[g.player].stats.resourcesGained += g.n;
    s.bank[g.res] -= g.n;
    const h = byPlayer.get(g.player) ?? {};
    h[g.res] = (h[g.res] ?? 0) + g.n;
    byPlayer.set(g.player, h);
  }
  const blocked = s.hexes[s.robber];
  if (blocked.number === sum && blocked.terrain !== 'desert' && t.hexCorners[s.robber].some((v) => s.buildings[v])) {
    log(s, null, `The robber blocks the ${sum} ${NAMES[blocked.terrain as Resource]}.`);
  }
  if (gains.length) emit(s, { kind: 'produce', gains });
  for (const [p, h] of byPlayer) log(s, p, `${s.players[p].name} gets ${handText(h)}.`);
  if (!gains.length) log(s, null, 'Nobody produces anything.');
}

function startTurn(s: GameState, p: number) {
  s.current = p;
  s.turn += 1;
  s.phase = 'roll';
  s.dice = null;
  s.devPlayedThisTurn = false;
  s.freeRoads = 0;
  s.trade = null;
  s.tradesThisTurn = 0;
  emit(s, { kind: 'turn', player: p });
  checkWin(s); // points earned off-turn (e.g. Longest Road) count now
}

function afterSteal(s: GameState) {
  s.phase = s.afterRobber;
}

function beginRobber(s: GameState, after: 'roll' | 'main') {
  s.afterRobber = after;
  s.phase = 'robber';
}

// ── the reducer ─────────────────────────────────────────────────────────────

const fail = (error: string): Result => ({ ok: false, error });

export function applyAction(prev: GameState, a: Action): Result {
  if (prev.phase === 'gameOver') return fail('The game is over.');
  if (!Number.isInteger(a.player) || a.player < 0 || a.player >= prev.players.length) return fail('Unknown player.');
  const s: GameState = structuredClone(prev);
  const p = a.player;
  const me = s.players[p];
  const isCurrent = p === s.current;

  switch (a.type) {
    // ── setup ──────────────────────────────────────────────────────────────
    case 'placeSettlement': {
      if (s.phase !== 'setup' || !s.setup || !isCurrent) return fail('Not your turn to place.');
      if (s.setup.step !== 'settlement') return fail('Place a road next.');
      if (!settlementSpots(s, p, true).includes(a.vertex)) return fail('Settlements need two empty corners between them.');
      s.buildings[a.vertex] = { owner: p, kind: 'settlement' };
      me.stats.settlementsBuilt++;
      emit(s, { kind: 'build', player: p, what: 'settlement', at: a.vertex });
      // The second settlement pays out one card per neighbouring hex.
      const second = s.setup.index >= s.players.length;
      if (second) {
        const got: PartialHand = {};
        for (const h of topo(s).vertices[a.vertex].hexes) {
          const r = resourceOf(s.hexes[h].terrain);
          if (r && s.bank[r] > 0) {
            me.hand[r]++; s.bank[r]--; got[r] = (got[r] ?? 0) + 1;
          }
        }
        if (handSize(got)) {
          emit(s, { kind: 'produce', gains: topo(s).vertices[a.vertex].hexes
            .filter((h) => resourceOf(s.hexes[h].terrain))
            .map((h) => ({ player: p, hex: h, res: resourceOf(s.hexes[h].terrain)!, n: 1 })) });
          log(s, p, `${me.name} places a settlement and collects ${handText(got)}.`);
        } else log(s, p, `${me.name} places a settlement.`);
      } else log(s, p, `${me.name} places a settlement.`);
      s.setup.step = 'road';
      s.setup.lastVertex = a.vertex;
      return { ok: true, state: s };
    }
    case 'placeRoad': {
      if (s.phase !== 'setup' || !s.setup || !isCurrent) return fail('Not your turn to place.');
      if (s.setup.step !== 'road') return fail('Place a settlement first.');
      if (!setupRoadSpots(s, p).includes(a.edge)) return fail('The road must touch the settlement you just placed.');
      s.roads[a.edge] = p;
      me.stats.roadsBuilt++;
      emit(s, { kind: 'build', player: p, what: 'road', at: a.edge });
      s.setup.index++;
      s.setup.step = 'settlement';
      s.setup.lastVertex = null;
      if (s.setup.index >= s.setup.order.length) {
        s.setup = null;
        log(s, null, 'Setup is done. Let the settling begin!');
        s.turn = 0;
        startTurn(s, s.current);
      } else {
        s.current = s.setup.order[s.setup.index];
      }
      return { ok: true, state: s };
    }

    // ── rolling ────────────────────────────────────────────────────────────
    case 'roll': {
      if (!isCurrent || s.phase !== 'roll') return fail('You can only roll at the start of your turn.');
      const d1 = rollDie(s), d2 = rollDie(s);
      s.dice = { a: d1, b: d2 };
      const sum = d1 + d2;
      emit(s, { kind: 'roll', player: p, a: d1, b: d2 });
      log(s, p, `${me.name} rolls ${sum}.`);
      if (sum === 7) {
        const must: Record<string, number> = {};
        s.players.forEach((pl, i) => {
          const n = handSize(pl.hand);
          if (n > 7) must[i] = Math.floor(n / 2);
        });
        s.mustDiscard = must;
        if (Object.keys(must).length) {
          s.phase = 'discard';
          s.afterRobber = 'main';
          log(s, null, `Seven! ${Object.keys(must).map((i) => s.players[+i].name).join(', ')} must discard half.`);
        } else {
          beginRobber(s, 'main');
        }
      } else {
        produce(s, sum);
        s.phase = 'main';
      }
      return { ok: true, state: s };
    }
    case 'discard': {
      if (s.phase !== 'discard') return fail('No discards are due.');
      const due = s.mustDiscard[p];
      if (!due) return fail('You don\'t need to discard.');
      if (!validHand(a.cards) || handSize(a.cards) !== due) return fail(`Choose exactly ${due} cards.`);
      if (!hasCards(me.hand, a.cards)) return fail('You don\'t have those cards.');
      pay(s, p, a.cards);
      delete s.mustDiscard[p];
      emit(s, { kind: 'discard', player: p, n: due });
      log(s, p, `${me.name} discards ${due}.`);
      if (!Object.keys(s.mustDiscard).length) beginRobber(s, 'main');
      return { ok: true, state: s };
    }
    case 'moveRobber': {
      if (!isCurrent || s.phase !== 'robber') return fail('You can\'t move the robber now.');
      if (!robberSpots(s, p).includes(a.hex)) return fail('The robber has to move somewhere else.');
      s.robber = a.hex;
      emit(s, { kind: 'robber', player: p, hex: a.hex });
      log(s, p, `${me.name} moves the robber.`);
      const targets = stealTargets(s, a.hex, p);
      if (targets.length === 0) afterSteal(s);
      else if (targets.length === 1) steal(s, p, targets[0]);
      else s.phase = 'steal';
      return { ok: true, state: s };
    }
    case 'steal': {
      if (!isCurrent || s.phase !== 'steal') return fail('Nothing to steal now.');
      if (!stealTargets(s, s.robber, p).includes(a.victim)) return fail('You can only rob a player next to the robber who has cards.');
      steal(s, p, a.victim);
      return { ok: true, state: s };
    }

    // ── building ───────────────────────────────────────────────────────────
    case 'buildRoad': {
      const free = s.phase === 'roadBuilding';
      if (!isCurrent || (s.phase !== 'main' && !free)) return fail('You can only build on your turn after rolling.');
      if (piecesLeft(s, p).road <= 0) return fail('You have no roads left.');
      if (!free && !canAfford(me.hand, COST.road)) return fail('A road costs 1 lumber and 1 brick.');
      if (!roadSpots(s, p).includes(a.edge)) return fail('Roads must connect to your roads or buildings.');
      if (!free) pay(s, p, COST.road);
      s.roads[a.edge] = p;
      me.stats.roadsBuilt++;
      emit(s, { kind: 'build', player: p, what: 'road', at: a.edge });
      log(s, p, `${me.name} builds a road${free ? ' (free)' : ''}.`);
      updateLongestRoad(s);
      if (free) {
        s.freeRoads--;
        if (s.freeRoads <= 0 || piecesLeft(s, p).road <= 0 || roadSpots(s, p).length === 0) {
          s.freeRoads = 0;
          s.phase = s.afterRobber; // where Road Building was played from
        }
      }
      checkWin(s);
      return { ok: true, state: s };
    }
    case 'skipRoads': {
      if (!isCurrent || s.phase !== 'roadBuilding') return fail('No free roads to skip.');
      s.freeRoads = 0;
      s.phase = s.afterRobber;
      return { ok: true, state: s };
    }
    case 'buildSettlement': {
      if (!isCurrent || s.phase !== 'main') return fail('You can only build on your turn after rolling.');
      if (piecesLeft(s, p).settlement <= 0) return fail('You have no settlements left. Upgrade one to a city.');
      if (!canAfford(me.hand, COST.settlement)) return fail('A settlement costs lumber, brick, wool and grain.');
      if (!settlementSpots(s, p).includes(a.vertex)) return fail('Settlements need your road and two empty corners between buildings.');
      pay(s, p, COST.settlement);
      s.buildings[a.vertex] = { owner: p, kind: 'settlement' };
      me.stats.settlementsBuilt++;
      emit(s, { kind: 'build', player: p, what: 'settlement', at: a.vertex });
      log(s, p, `${me.name} builds a settlement.`);
      updateLongestRoad(s); // a settlement can cut someone's road
      checkWin(s);
      return { ok: true, state: s };
    }
    case 'buildCity': {
      if (!isCurrent || s.phase !== 'main') return fail('You can only build on your turn after rolling.');
      if (piecesLeft(s, p).city <= 0) return fail('You have no cities left.');
      if (!canAfford(me.hand, COST.city)) return fail('A city costs 2 grain and 3 ore.');
      if (!citySpots(s, p).includes(a.vertex)) return fail('Cities replace one of your settlements.');
      pay(s, p, COST.city);
      s.buildings[a.vertex] = { owner: p, kind: 'city' };
      me.stats.citiesBuilt++;
      emit(s, { kind: 'build', player: p, what: 'city', at: a.vertex });
      log(s, p, `${me.name} builds a city.`);
      checkWin(s);
      return { ok: true, state: s };
    }

    // ── development cards ──────────────────────────────────────────────────
    case 'buyDev': {
      if (!isCurrent || s.phase !== 'main') return fail('You can only buy on your turn after rolling.');
      if (!s.devDeck.length) return fail('The development deck is empty.');
      if (!canAfford(me.hand, COST.dev)) return fail('A development card costs wool, grain and ore.');
      pay(s, p, COST.dev);
      const kind = s.devDeck.pop()!;
      me.devCards.push({ kind, boughtTurn: s.turn });
      me.stats.devBought++;
      emit(s, { kind: 'devBuy', player: p });
      log(s, p, `${me.name} buys a development card.`);
      checkWin(s); // a Victory Point card counts straight away
      return { ok: true, state: s };
    }
    case 'playKnight':
    case 'playRoadBuilding':
    case 'playYearOfPlenty':
    case 'playMonopoly': {
      const kind: DevKind = a.type === 'playKnight' ? 'knight' : a.type === 'playRoadBuilding' ? 'roadBuilding'
        : a.type === 'playYearOfPlenty' ? 'yearOfPlenty' : 'monopoly';
      if (!isCurrent) return fail('Not your turn.');
      if (s.phase !== 'main' && !(s.phase === 'roll' && kind === 'knight')) {
        return fail(kind === 'knight' ? 'Play a knight before rolling or after.' : 'Play this after rolling.');
      }
      if (s.devPlayedThisTurn) return fail('Only one development card per turn.');
      const idx = me.devCards.findIndex((c) => c.kind === kind && c.boughtTurn !== s.turn);
      if (idx < 0) {
        return fail(me.devCards.some((c) => c.kind === kind) ? 'Cards bought this turn can be played next turn.' : 'You don\'t have that card.');
      }
      if (a.type === 'playYearOfPlenty') {
        if (!validHand(a.take) || handSize(a.take) !== 2) return fail('Pick two resources.');
        if (!RESOURCES.every((r) => s.bank[r] >= (a.take[r] ?? 0))) return fail('The bank doesn\'t have those.');
      }
      if (a.type === 'playRoadBuilding' && (piecesLeft(s, p).road <= 0 || roadSpots(s, p).length === 0)) {
        return fail('You have nowhere to build a road.');
      }
      me.devCards.splice(idx, 1);
      s.devPlayedThisTurn = true;
      me.stats.devPlayed++;
      emit(s, { kind: 'devPlay', player: p, card: kind });
      if (a.type === 'playKnight') {
        me.knights++;
        log(s, p, `${me.name} plays a Knight.`);
        updateLargestArmy(s, p);
        beginRobber(s, s.phase === 'roll' ? 'roll' : 'main');
        checkWin(s);
      } else if (a.type === 'playRoadBuilding') {
        log(s, p, `${me.name} plays Road Building.`);
        s.freeRoads = 2;
        s.afterRobber = 'main';
        s.phase = 'roadBuilding';
      } else if (a.type === 'playYearOfPlenty') {
        for (const r of RESOURCES) {
          const n = a.take[r] ?? 0;
          me.hand[r] += n; s.bank[r] -= n;
        }
        log(s, p, `${me.name} plays Year of Plenty and takes ${handText(a.take)}.`);
      } else {
        let total = 0;
        s.players.forEach((pl, i) => {
          if (i === p) return;
          total += pl.hand[a.res];
          pl.hand[a.res] = 0;
        });
        me.hand[a.res] += total;
        log(s, p, `${me.name} plays Monopoly on ${NAMES[a.res]} and collects ${total}.`);
      }
      return { ok: true, state: s };
    }

    // ── trading ────────────────────────────────────────────────────────────
    case 'bankTrade': {
      if (!isCurrent || s.phase !== 'main') return fail('Trade on your turn after rolling.');
      const times = a.times ?? 1;
      if (!Number.isInteger(times) || times < 1) return fail('Bad trade.');
      if (a.give === a.get) return fail('Pick two different resources.');
      if (!RESOURCES.includes(a.give) || !RESOURCES.includes(a.get)) return fail('Bad trade.');
      const rate = tradeRates(s, p)[a.give];
      if (me.hand[a.give] < rate * times) return fail(`You need ${rate * times} ${NAMES[a.give]}.`);
      if (s.bank[a.get] < times) return fail(`The bank is out of ${NAMES[a.get]}.`);
      me.hand[a.give] -= rate * times; s.bank[a.give] += rate * times;
      me.hand[a.get] += times; s.bank[a.get] -= times;
      me.stats.trades++;
      emit(s, { kind: 'trade', a: p, b: null });
      log(s, p, `${me.name} trades ${rate * times} ${NAMES[a.give]} for ${times} ${NAMES[a.get]} with the ${rate < 4 ? 'harbour' : 'bank'}.`);
      return { ok: true, state: s };
    }
    case 'offerTrade': {
      if (!isCurrent || s.phase !== 'main') return fail('Offer trades on your turn after rolling.');
      if (!validHand(a.give) || !validHand(a.get)) return fail('Bad trade.');
      if (!handSize(a.give) || !handSize(a.get)) return fail('Both sides need at least one card.');
      if (RESOURCES.some((r) => (a.give[r] ?? 0) > 0 && (a.get[r] ?? 0) > 0)) return fail('Don\'t ask for what you\'re giving.');
      if (!hasCards(me.hand, a.give)) return fail('You don\'t have those cards.');
      const responses: Record<string, 'pending' | 'accept' | 'reject'> = {};
      s.players.forEach((_, i) => { if (i !== p) responses[i] = 'pending'; });
      s.trade = { id: s.seq + 1, from: p, give: clean(a.give), get: clean(a.get), responses };
      s.tradesThisTurn++;
      log(s, p, `${me.name} offers ${handText(a.give)} for ${handText(a.get)}.`);
      return { ok: true, state: s };
    }
    case 'respondTrade': {
      const t = s.trade;
      if (!t || t.responses[p] === undefined) return fail('No trade offer for you.');
      if (a.accept && !hasCards(me.hand, t.get)) return fail('You don\'t have the cards they want.');
      t.responses[p] = a.accept ? 'accept' : 'reject';
      return { ok: true, state: s };
    }
    case 'acceptTrade': {
      const t = s.trade;
      if (!t || !isCurrent || t.from !== p) return fail('No offer to complete.');
      if (t.responses[a.partner] !== 'accept') return fail('That player hasn\'t accepted.');
      const other = s.players[a.partner];
      if (!hasCards(me.hand, t.give) || !hasCards(other.hand, t.get)) {
        s.trade = null;
        return fail('Someone no longer has the cards.');
      }
      for (const r of RESOURCES) {
        const g = t.give[r] ?? 0, w = t.get[r] ?? 0;
        me.hand[r] += w - g;
        other.hand[r] += g - w;
      }
      me.stats.trades++; other.stats.trades++;
      emit(s, { kind: 'trade', a: p, b: a.partner });
      log(s, p, `${me.name} trades ${handText(t.give)} to ${other.name} for ${handText(t.get)}.`);
      s.trade = null;
      return { ok: true, state: s };
    }
    case 'cancelTrade': {
      if (!s.trade || s.trade.from !== p) return fail('No offer to cancel.');
      s.trade = null;
      return { ok: true, state: s };
    }

    case 'endTurn': {
      if (!isCurrent || s.phase !== 'main') return fail(s.phase === 'roll' ? 'Roll first.' : 'Finish what you\'re doing first.');
      startTurn(s, (p + 1) % s.players.length);
      return { ok: true, state: s };
    }
  }
  return fail('Unknown action.');
}

function clean(h: PartialHand): PartialHand {
  const out: PartialHand = {};
  for (const r of RESOURCES) if ((h[r] ?? 0) > 0) out[r] = h[r];
  return out;
}

function steal(s: GameState, thief: number, victim: number) {
  const hand = s.players[victim].hand;
  const pool: Resource[] = [];
  for (const r of RESOURCES) for (let i = 0; i < hand[r]; i++) pool.push(r);
  let res: Resource | null = null;
  if (pool.length) {
    res = pool[randomInt(s, pool.length)];
    hand[res]--;
    s.players[thief].hand[res]++;
    s.players[thief].stats.stolen++;
    s.players[victim].stats.timesRobbed++;
  }
  emit(s, { kind: 'steal', thief, victim, res });
  log(s, thief, `${s.players[thief].name} robs ${s.players[victim].name}.`);
  afterSteal(s);
}

// ── what can this player do right now? ──────────────────────────────────────

export function waitingOn(s: GameState): number[] {
  if (s.phase === 'gameOver') return [];
  if (s.phase === 'discard') return Object.keys(s.mustDiscard).map(Number);
  if (s.trade) {
    const pending = Object.entries(s.trade.responses).filter(([, v]) => v === 'pending').map(([k]) => Number(k));
    return [...new Set([s.current, ...pending])];
  }
  return [s.current];
}

export { publicVP, totalVP };
