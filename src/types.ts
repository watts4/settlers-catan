// Types for Settlers of Catan

export interface MultiplayerConfig {
  roomId: string;
  mySlot: number;
  isHost: boolean;
  playerName: string;
}

export type Resource = 'wood' | 'brick' | 'sheep' | 'wheat' | 'ore' | 'desert' | 'gold';
export type PieceType = 'road' | 'settlement' | 'city' | 'ship';

export interface Hex {
  id: string;
  q: number; // axial coordinates
  r: number;
  resource: Resource;
  number: number | null; // dice number (null for desert/gold)
  hasRobber: boolean;
}

export interface Port {
  id: string;
  location: { q: number; r: number; edge: number }; // hex + edge
  resource: Resource | 'generic';
  ratio: number;
}

export interface Vertex {
  id: string;
  q: number;
  r: number;
  location: number; // 0-5 on hex
  x: number; // pixel x position
  y: number; // pixel y position
  settlements: { [playerId: string]: 'settlement' | 'city' | null };
}

export interface Edge {
  id: string;
  q: number;
  r: number;
  location: number; // 0-5 on hex
  x1: number; // pixel coords of first endpoint
  y1: number;
  x2: number; // pixel coords of second endpoint
  y2: number;
  roads: { [playerId: string]: PieceType | null };
}

export interface Player {
  id: number;
  name: string;
  color: string;
  resources: { [key in Resource]?: number };
  pieces: {
    roads: number;
    settlements: number;
    cities: number;
    ships: number;
  };
  devCards: string[];
  victoryPoints: number;
  knightsPlayed: number;
  longestRoad: number;
  isHuman: boolean;
}

export type GamePhase =
  | 'setup1'      // First settlement placement (clockwise)
  | 'setup2'      // Second settlement placement (reverse order)
  | 'playing'     // Main game - rolling
  | 'trading'     // Trading phase
  | 'building'    // Building phase
  | 'robing'      // Moving robber after rolling 7
  | 'discarding'  // Discarding cards after rolling 7
  | 'gameOver';   // Game ended

export interface GameLogEntry {
  turn: number;
  player: number;
  action: string;
  timestamp: number;
}

export interface GameState {
  players: Player[];
  board: {
    hexes: Hex[];
    vertices: Vertex[];
    edges: Edge[];
    ports: Port[];
  };
  currentPlayer: number;
  phase: GamePhase;
  dice: [number, number] | null;
  turn: number;
  devCardDeck: string[];
  longestRoadHolder: number | null;
  largestArmyHolder: number | null;
  winner: number | null;
  log: GameLogEntry[];
  setupRound: number;
  playersFinishedSetup: number[];
  // Setup phase tracking
  setupStep: 'settlement' | 'road'; // what the current player must place next during setup
  setupLastSettlementVertexId: string | null; // road must touch this vertex during setup
  playersToDiscard: number[];
  selectedHexForRobber: Hex | null;
  stealFromPlayer: number | null;
}
