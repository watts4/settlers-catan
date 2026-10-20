import type { GameState } from '../engine/types';
import { longestRoadOf, piecesLeft, totalVP } from '../engine/rules';
import type { GameRecord, WinStrategy } from './types';

export function extractGameStats(game: GameState, p: number, isSolo: boolean): GameRecord {
  const player = game.players[p];
  const won = game.winner === p;
  const mine = Object.values(game.buildings).filter((b) => b.owner === p);
  const vpFromSettlements = mine.filter((b) => b.kind === 'settlement').length;
  const vpFromCities = mine.filter((b) => b.kind === 'city').length * 2;
  const vpFromLongestRoad = game.longestRoad.holder === p ? 2 : 0;
  const vpFromLargestArmy = game.largestArmy.holder === p ? 2 : 0;
  const vpFromDevCards = player.devCards.filter((c) => c.kind === 'victory').length;
  const left = piecesLeft(game, p);

  let winStrategy: WinStrategy | null = null;
  if (won) {
    if (vpFromLongestRoad && vpFromLargestArmy) winStrategy = 'dominator';
    else if (!vpFromLongestRoad && !vpFromLargestArmy && !vpFromDevCards) winStrategy = 'pure_builder';
    else if (vpFromDevCards >= 3) winStrategy = 'dev_card_heavy';
    else if (vpFromLongestRoad) winStrategy = 'road_warrior';
    else if (vpFromLargestArmy) winStrategy = 'army_commander';
    else winStrategy = 'balanced';
  }

  return {
    gameId: game.id,
    date: Date.now(),
    won,
    finalVP: totalVP(game, p),
    vpTarget: game.config.vpToWin,
    numPlayers: game.players.length,
    settlementsBuilt: player.stats.settlementsBuilt,
    citiesBuilt: player.stats.citiesBuilt,
    roadsBuilt: player.stats.roadsBuilt,
    devCardsBought: player.stats.devBought,
    devCardsPlayed: player.stats.devPlayed,
    knightsPlayed: player.knights,
    hadLongestRoad: !!vpFromLongestRoad,
    hadLargestArmy: !!vpFromLargestArmy,
    longestRoadLength: longestRoadOf(game, p),
    vpFromSettlements, vpFromCities, vpFromDevCards, vpFromLongestRoad, vpFromLargestArmy,
    exhaustedSettlements: left.settlement === 0,
    exhaustedCities: left.city === 0,
    exhaustedRoads: left.road === 0,
    winStrategy,
    totalTurns: game.turn,
    isSolo,
  };
}
