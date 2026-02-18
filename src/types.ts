// Types for Settlers of Catan

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
  settlements: { [playerId: string]: 'settlement' | 'city' | null };
}

export interface Edge {
  id: string;
  q: number;
  r: number;
  location: number; // 0-5 on hex
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
  // New fields for setup phase
  setupRound: number;  // 1 or 2
  playersFinishedSetup: number[];  // track who has completed setup
  // New fields for 7 handling
  playersToDiscard: number[];  // players who need to discard
  selectedHexForRobber: Hex | null;  // hex selected for robber
  stealFromPlayer: number | null;  // player to steal from
}
