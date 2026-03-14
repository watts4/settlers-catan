export interface GameRecord {
  gameId: string;
  date: number;
  won: boolean;
  finalVP: number;
  vpTarget: number;
  numPlayers: number;
  settlementsBuilt: number;
  citiesBuilt: number;
  roadsBuilt: number;
  devCardsBought: number;
  devCardsPlayed: number;
  knightsPlayed: number;
  hadLongestRoad: boolean;
  hadLargestArmy: boolean;
  longestRoadLength: number;
  vpFromSettlements: number;
  vpFromCities: number;
  vpFromDevCards: number;
  vpFromLongestRoad: number;
  vpFromLargestArmy: number;
  exhaustedSettlements: boolean;
  exhaustedCities: boolean;
  exhaustedRoads: boolean;
  winStrategy: WinStrategy | null;
  totalTurns: number;
  isSolo: boolean;
}

export type WinStrategy =
  | 'balanced'
  | 'road_warrior'
  | 'army_commander'
  | 'dominator'
  | 'pure_builder'
  | 'dev_card_heavy';

export interface UserStats {
  uid: string;
  displayName: string;
  photoURL: string | null;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  currentWinStreak: number;
  bestWinStreak: number;
  totalSettlementsBuilt: number;
  totalCitiesBuilt: number;
  totalRoadsBuilt: number;
  totalDevCardsBought: number;
  totalDevCardsPlayed: number;
  totalKnightsPlayed: number;
  timesHadLongestRoad: number;
  timesHadLargestArmy: number;
  longestRoadEver: number;
  gamesExhaustedSettlements: number;
  gamesExhaustedCities: number;
  gamesExhaustedRoads: number;
  winsByStrategy: Record<WinStrategy, number>;
  highestVP: number;
  totalVPAccumulated: number;
  badges: EarnedBadge[];
  recentGames: GameRecord[];
  firstGameAt: number;
  lastGameAt: number;
}

export interface EarnedBadge {
  id: string;
  earnedAt: number;
}

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'wins' | 'building' | 'strategy' | 'milestones' | 'mastery';
  checkEarned: (stats: UserStats) => boolean;
}
