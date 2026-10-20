// Game data for the rules engine. Everything here is plain JSON so the whole
// state can live in localStorage or a Firestore document as-is: no classes, no
// undefined, no arrays nested directly inside arrays.

export const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const;
export type Resource = (typeof RESOURCES)[number];
export type Terrain = Resource | 'desert';
export type Hand = Record<Resource, number>;
export type PartialHand = Partial<Record<Resource, number>>;

export type DevKind = 'knight' | 'victory' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly';

export interface HexTile {
  q: number;
  r: number;
  terrain: Terrain;
  number: number | null;
}

export interface PortSpot {
  edge: string; // coastal edge id; its two corners get the rate
  kind: Resource | 'any';
}

export interface Building {
  owner: number;
  kind: 'settlement' | 'city';
}

export interface DevCard {
  kind: DevKind;
  boughtTurn: number; // can't be played on the turn it was bought
}

export type Controller = 'human' | 'ai';
export type AiLevel = 'easy' | 'normal' | 'hard';

export interface PlayerStats {
  roadsBuilt: number;
  settlementsBuilt: number;
  citiesBuilt: number;
  devBought: number;
  devPlayed: number;
  resourcesGained: number;
  stolen: number;
  timesRobbed: number;
  trades: number;
}

export interface Player {
  name: string;
  color: string;
  controller: Controller;
  aiLevel: AiLevel;
  hand: Hand;
  devCards: DevCard[];
  knights: number;
  stats: PlayerStats;
}

export type Phase =
  | 'setup'        // placing starting settlements and roads
  | 'roll'         // current player must roll (or play a knight first)
  | 'main'         // build, trade, play a card, end turn
  | 'discard'      // a 7 was rolled; players over 7 cards discard half
  | 'robber'       // current player moves the robber
  | 'steal'        // current player picks whom to rob
  | 'roadBuilding' // placing the free roads from a Road Building card
  | 'gameOver';

export interface TradeOffer {
  id: number;
  from: number;
  give: PartialHand; // what `from` gives
  get: PartialHand;  // what `from` receives
  // per other player: pending until they answer
  responses: Record<string, 'pending' | 'accept' | 'reject'>;
}

export interface LogEntry {
  turn: number;
  player: number | null;
  text: string;
}

// Things that just happened, for animation and sound. Clients play every
// event with a seq above the last one they saw.
export type GameEvent =
  | { seq: number; kind: 'roll'; player: number; a: number; b: number }
  | { seq: number; kind: 'produce'; gains: { player: number; hex: number; res: Resource; n: number }[] }
  | { seq: number; kind: 'build'; player: number; what: 'road' | 'settlement' | 'city'; at: string }
  | { seq: number; kind: 'robber'; player: number; hex: number }
  | { seq: number; kind: 'steal'; thief: number; victim: number; res: Resource | null }
  | { seq: number; kind: 'discard'; player: number; n: number }
  | { seq: number; kind: 'devBuy'; player: number }
  | { seq: number; kind: 'devPlay'; player: number; card: DevKind }
  | { seq: number; kind: 'trade'; a: number; b: number | null }
  | { seq: number; kind: 'award'; player: number | null; award: 'longestRoad' | 'largestArmy' }
  | { seq: number; kind: 'turn'; player: number }
  | { seq: number; kind: 'win'; player: number };

export type GameEventKind = GameEvent['kind'];

export interface GameConfig {
  vpToWin: number;
  friendlyRobber: boolean; // robber can't hit players with 2 or fewer points
}

export interface SetupState {
  order: number[];  // e.g. 0 1 2 3 3 2 1 0
  index: number;
  step: 'settlement' | 'road';
  lastVertex: string | null;
}

export interface GameState {
  schema: 2;
  id: string;                // for stats, so a game is recorded once
  rng: number;               // dice and shuffles, so every client agrees
  config: GameConfig;
  hexes: HexTile[];
  ports: PortSpot[];
  robber: number;            // index into hexes
  buildings: Record<string, Building>;
  roads: Record<string, number>;
  players: Player[];
  bank: Hand;
  devDeck: DevKind[];
  turn: number;
  current: number;
  phase: Phase;
  setup: SetupState | null;
  dice: { a: number; b: number } | null;
  devPlayedThisTurn: boolean;
  freeRoads: number;
  afterRobber: 'roll' | 'main';
  mustDiscard: Record<string, number>;
  longestRoad: { holder: number | null; length: number };
  largestArmy: { holder: number | null; size: number };
  trade: TradeOffer | null;
  tradesThisTurn: number;
  winner: number | null;
  log: LogEntry[];
  events: GameEvent[];
  seq: number;
}

export type Action =
  | { type: 'placeSettlement'; player: number; vertex: string }  // setup
  | { type: 'placeRoad'; player: number; edge: string }          // setup
  | { type: 'roll'; player: number }
  | { type: 'buildRoad'; player: number; edge: string }
  | { type: 'buildSettlement'; player: number; vertex: string }
  | { type: 'buildCity'; player: number; vertex: string }
  | { type: 'buyDev'; player: number }
  | { type: 'playKnight'; player: number }
  | { type: 'playRoadBuilding'; player: number }
  | { type: 'playYearOfPlenty'; player: number; take: PartialHand }
  | { type: 'playMonopoly'; player: number; res: Resource }
  | { type: 'moveRobber'; player: number; hex: number }
  | { type: 'steal'; player: number; victim: number }
  | { type: 'discard'; player: number; cards: PartialHand }
  | { type: 'bankTrade'; player: number; give: Resource; get: Resource; times?: number }
  | { type: 'offerTrade'; player: number; give: PartialHand; get: PartialHand }
  | { type: 'respondTrade'; player: number; accept: boolean }
  | { type: 'acceptTrade'; player: number; partner: number }
  | { type: 'cancelTrade'; player: number }
  | { type: 'skipRoads'; player: number }
  | { type: 'endTurn'; player: number };

export type ActionType = Action['type'];
