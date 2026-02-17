// Simple AI for Catan

import type { GameState, Player } from './types';

// Simple AI that makes reasonable moves
export function aiTurn(_state: GameState): void {
  // AI logic placeholder - simplified version
  // In a full implementation, this would:
  // - Evaluate best moves
  // - Build roads/settlements
  // - Trade resources
  // - Play dev cards
}

// Evaluate player position
export function evaluatePosition(player: Player, _state: GameState): number {
  let score = 0;
  
  score += player.pieces.settlements * 3;
  score += player.pieces.cities * 5;
  
  score += player.knightsPlayed * 3;
  score += player.longestRoad * 2;
  
  // Resource diversity
  const resources = Object.values(player.resources).filter(r => r && r > 0).length;
  score += resources * 2;
  
  return score;
}
