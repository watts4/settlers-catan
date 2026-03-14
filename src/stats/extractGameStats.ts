import type { GameState } from '../types';
import type { GameRecord, WinStrategy } from './types';

export function extractGameStats(game: GameState, playerIndex: number, isSolo: boolean): GameRecord {
  const player = game.players[playerIndex];
  const won = game.winner === playerIndex;

  const settlementsBuilt = 5 - player.pieces.settlements;
  const citiesBuilt = 4 - player.pieces.cities;
  const roadsBuilt = 15 - player.pieces.roads;

  // Count settlements and cities on the board
  const vpFromSettlements = game.board.vertices.filter(v => v.settlements[playerIndex] === 'settlement').length;
  const vpFromCities = game.board.vertices.filter(v => v.settlements[playerIndex] === 'city').length * 2;
  const vpFromLongestRoad = game.longestRoadHolder === playerIndex ? 2 : 0;
  const vpFromLargestArmy = game.largestArmyHolder === playerIndex ? 2 : 0;
  const vpFromDevCards = player.devCards.filter(c => c === 'victory').length;
  const finalVP = vpFromSettlements + vpFromCities + vpFromLongestRoad + vpFromLargestArmy + vpFromDevCards;

  // Count dev cards played from log
  const devCardsPlayed = game.log.filter(e => e.player === playerIndex && /played a|used/i.test(e.action)).length;
  const devCardsBought = player.devCards.length + devCardsPlayed;

  let winStrategy: WinStrategy | null = null;
  if (won) {
    if (vpFromLongestRoad > 0 && vpFromLargestArmy > 0) winStrategy = 'dominator';
    else if (vpFromLongestRoad === 0 && vpFromLargestArmy === 0 && vpFromDevCards === 0) winStrategy = 'pure_builder';
    else if (vpFromDevCards >= 3) winStrategy = 'dev_card_heavy';
    else if (vpFromLongestRoad > 0) winStrategy = 'road_warrior';
    else if (vpFromLargestArmy > 0) winStrategy = 'army_commander';
    else winStrategy = 'balanced';
  }

  return {
    gameId: crypto.randomUUID(),
    date: Date.now(),
    won, finalVP, vpTarget: 10, numPlayers: game.players.length,
    settlementsBuilt, citiesBuilt, roadsBuilt,
    devCardsBought, devCardsPlayed, knightsPlayed: player.knightsPlayed,
    hadLongestRoad: game.longestRoadHolder === playerIndex,
    hadLargestArmy: game.largestArmyHolder === playerIndex,
    longestRoadLength: player.longestRoad,
    vpFromSettlements, vpFromCities, vpFromDevCards, vpFromLongestRoad, vpFromLargestArmy,
    exhaustedSettlements: player.pieces.settlements === 0,
    exhaustedCities: player.pieces.cities === 0,
    exhaustedRoads: player.pieces.roads === 0,
    winStrategy, totalTurns: game.turn, isSolo,
  };
}
