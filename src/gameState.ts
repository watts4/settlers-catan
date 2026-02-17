// Game state management for Settlers of Catan

import type { GameState, Player, Resource } from './types';
import { generateBoard } from './board';

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#ecf0f1', '#e67e22']; // red, blue, white (or light gray), orange
const PLAYER_NAMES = ['You', 'Red', 'Blue', 'Orange'];

const DEV_CARDS = [
  'knight', 'knight', 'knight', 'knight', 'knight', 'knight', 'knight', 'knight', 'knight',
  'knight', 'knight', 'knight', 'knight', 'knight',
  'road', 'road', 'road', 'road', 'road',
  'plenty', 'plenty', 'plenty', 'plenty',
  'monopoly', 'monopoly', 'monopoly', 'monopoly',
  'victory', 'victory', 'victory', 'victory',
];

export function createInitialGameState(): GameState {
  const { hexes, vertices, edges, ports } = generateBoard();
  
  // Shuffle dev cards
  const shuffledDevCards = [...DEV_CARDS].sort(() => Math.random() - 0.5);
  
  // Give human player starting resources for testing
  const players: Player[] = [0, 1, 2, 3].map(i => ({
    id: i,
    name: PLAYER_NAMES[i],
    color: PLAYER_COLORS[i],
    resources: i === 0 ? { 
      wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 
    } : { 
      wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 
    },
    pieces: {
      roads: 15,
      settlements: 5,
      cities: 4,
      ships: 15,
    },
    devCards: [],
    victoryPoints: 0,
    knightsPlayed: 0,
    longestRoad: 0,
    isHuman: i === 0,
  }));

  return {
    players,
    board: { hexes, vertices, edges, ports },
    currentPlayer: 0,
    phase: 'setup',
    dice: null,
    turn: 1,
    devCardDeck: shuffledDevCards,
    longestRoadHolder: null,
    largestArmyHolder: null,
    winner: null,
    log: [],
  };
}

// Roll dice
export function rollDice(): [number, number] {
  return [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1];
}

// Distribute resources based on dice roll
export function distributeResources(state: GameState, diceSum: number): void {
  if (diceSum === 7) return; // Robber blocks
  
  state.board.hexes.forEach(hex => {
    if (hex.number === diceSum && !hex.hasRobber) {
      // Get all vertices on this hex
      const hexVertices = state.board.vertices.filter(v => {
        const dq = Math.abs(v.q - hex.q);
        const dr = Math.abs(v.r - hex.r);
        return dq < 1 && dr < 1;
      });
      
      hexVertices.forEach(vertex => {
        Object.entries(vertex.settlements).forEach(([playerId, type]) => {
          if (type) {
            const player = state.players[parseInt(playerId)];
            const amount = type === 'settlement' ? 1 : 2;
            
            if (hex.resource !== 'desert' && hex.resource !== 'gold') {
              player.resources[hex.resource] = (player.resources[hex.resource] || 0) + amount;
            }
          }
        });
      });
    }
  });
}

// Check if player can afford something
export function canAfford(player: Player, cost: Partial<Record<Resource, number>>): boolean {
  return Object.entries(cost).every(([res, amount]) => {
    return (player.resources[res as Resource] || 0) >= amount;
  });
}

// Build costs
export const BUILD_COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, wheat: 1, sheep: 1 },
  city: { wheat: 2, ore: 3 },
  ship: { wood: 1, sheep: 1 },
  devCard: { wheat: 1, sheep: 1, ore: 1 },
};

// Calculate victory points
export function calculateVP(player: Player, state: GameState): number {
  let vp = 0;
  
  // VP from settlements and cities
  Object.values(player.pieces.settlements || 0).forEach(() => vp++);
  Object.values(player.pieces.cities || 0).forEach(city => {
    if (city) vp += 2;
  });
  
  // VP from dev cards (only ones played)
  vp += (player.devCards.filter(c => c !== 'victory').length);
  
  // Largest Army
  if (state.largestArmyHolder === player.id) vp += 2;
  
  // Longest Road
  if (state.longestRoadHolder === player.id) vp += 2;
  
  // Unexplayed victory point cards still count
  const unplayedVP = player.devCards.filter(c => c === 'victory').length;
  vp += unplayedVP;
  
  return vp;
}

// Check for win
export function checkWinCondition(state: GameState): number | null {
  for (const player of state.players) {
    const vp = calculateVP(player, state);
    if (vp >= 10) return player.id;
  }
  return null;
}

// Add log entry
export function addLog(state: GameState, action: string): void {
  state.log.push({
    turn: state.turn,
    player: state.currentPlayer,
    action,
    timestamp: Date.now(),
  });
}
