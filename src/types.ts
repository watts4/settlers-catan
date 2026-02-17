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

export interface GameState {
  players: Player[];
  board: {
    hexes: Hex[];
    vertices: Vertex[];
    edges: Edge[];
    ports: Port[];
  };
  currentPlayer: number;
  phase: 'setup' | 'playing' | 'trading' | 'gameOver';
  dice: [number, number] | null;
  turn: number;
  devCardDeck: string[];
  longestRoadHolder: number | null;
  largestArmyHolder: number | null;
  winner: number | null;
  log: GameLogEntry[];
}

export interface GameLogEntry {
  turn: number;
  player: number;
  action: string;
  timestamp: number;
}
