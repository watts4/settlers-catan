import type { BadgeDefinition } from './types';

export const BADGES: BadgeDefinition[] = [
  // ── Wins ──────────────────────────────────────────────
  {
    id: 'first_win', name: 'First Victory', description: 'Win your first game',
    icon: '\u{1F3C6}', category: 'wins',
    checkEarned: s => s.gamesWon >= 1,
  },
  {
    id: 'veteran_winner', name: 'Veteran Winner', description: 'Win 10 games',
    icon: '\u{1F396}\uFE0F', category: 'wins',
    checkEarned: s => s.gamesWon >= 10,
  },
  {
    id: 'champion', name: 'Champion', description: 'Win 25 games',
    icon: '\u{1F451}', category: 'wins',
    checkEarned: s => s.gamesWon >= 25,
  },
  {
    id: 'legend', name: 'Living Legend', description: 'Win 50 games',
    icon: '\u{1F31F}', category: 'wins',
    checkEarned: s => s.gamesWon >= 50,
  },
  {
    id: 'win_streak_3', name: 'Hat Trick', description: 'Win 3 games in a row',
    icon: '\u{1F525}', category: 'wins',
    checkEarned: s => s.bestWinStreak >= 3,
  },
  {
    id: 'win_streak_5', name: 'On Fire', description: 'Win 5 games in a row',
    icon: '\u{1F4A5}', category: 'wins',
    checkEarned: s => s.bestWinStreak >= 5,
  },
  {
    id: 'win_streak_10', name: 'Unstoppable', description: 'Win 10 games in a row',
    icon: '\u26A1', category: 'wins',
    checkEarned: s => s.bestWinStreak >= 10,
  },

  // ── Building ──────────────────────────────────────────
  {
    id: 'settler', name: 'True Settler', description: 'Use all 5 settlements in a single game',
    icon: '\u{1F3D8}\uFE0F', category: 'building',
    checkEarned: s => s.gamesExhaustedSettlements >= 1,
  },
  {
    id: 'city_planner', name: 'City Planner', description: 'Use all 4 cities in a single game',
    icon: '\u{1F3D9}\uFE0F', category: 'building',
    checkEarned: s => s.gamesExhaustedCities >= 1,
  },
  {
    id: 'road_network', name: 'Road Network', description: 'Use all 15 roads in a single game',
    icon: '\u{1F6E3}\uFE0F', category: 'building',
    checkEarned: s => s.gamesExhaustedRoads >= 1,
  },
  {
    id: 'master_builder', name: 'Master Builder', description: 'Exhaust all settlements AND cities in the same game',
    icon: '\u{1F3F0}', category: 'building',
    checkEarned: s => s.recentGames.some(g => g.exhaustedSettlements && g.exhaustedCities),
  },
  {
    id: 'total_builder_100', name: 'Century of Settlements', description: 'Build 100 total settlements across all games',
    icon: '\u{1F3E0}', category: 'building',
    checkEarned: s => s.totalSettlementsBuilt >= 100,
  },
  {
    id: 'total_roads_500', name: 'Highway System', description: 'Build 500 total roads across all games',
    icon: '\u{1F6A7}', category: 'building',
    checkEarned: s => s.totalRoadsBuilt >= 500,
  },

  // ── Strategy ──────────────────────────────────────────
  {
    id: 'pure_builder', name: 'Pure Builder', description: 'Win without longest road, largest army, or VP cards',
    icon: '\u{1F9F1}', category: 'strategy',
    checkEarned: s => s.winsByStrategy.pure_builder >= 1,
  },
  {
    id: 'road_warrior', name: 'Road Warrior', description: 'Win with longest road',
    icon: '\u{1F6E4}\uFE0F', category: 'strategy',
    checkEarned: s => s.winsByStrategy.road_warrior >= 1,
  },
  {
    id: 'army_commander', name: 'Army Commander', description: 'Win with largest army',
    icon: '\u2694\uFE0F', category: 'strategy',
    checkEarned: s => s.winsByStrategy.army_commander >= 1,
  },
  {
    id: 'dominator', name: 'Dominator', description: 'Win with both longest road and largest army',
    icon: '\u{1F4AA}', category: 'strategy',
    checkEarned: s => s.winsByStrategy.dominator >= 1,
  },
  {
    id: 'dev_card_shark', name: 'Dev Card Shark', description: 'Buy 10+ development cards in a single game',
    icon: '\u{1F0CF}', category: 'strategy',
    checkEarned: s => s.recentGames.some(g => g.devCardsBought >= 10),
  },
  {
    id: 'versatile', name: 'Versatile Strategist', description: 'Win using 3 or more different strategies',
    icon: '\u{1F3AF}', category: 'strategy',
    checkEarned: s => {
      const strats = Object.values(s.winsByStrategy).filter(v => v > 0).length;
      return strats >= 3;
    },
  },

  // ── Milestones ────────────────────────────────────────
  {
    id: 'first_game', name: 'Welcome to Catan', description: 'Play your first game',
    icon: '\u{1F44B}', category: 'milestones',
    checkEarned: s => s.gamesPlayed >= 1,
  },
  {
    id: 'games_10', name: 'Regular Player', description: 'Play 10 games',
    icon: '\u{1F3B2}', category: 'milestones',
    checkEarned: s => s.gamesPlayed >= 10,
  },
  {
    id: 'games_50', name: 'Dedicated Settler', description: 'Play 50 games',
    icon: '\u{1F3DD}\uFE0F', category: 'milestones',
    checkEarned: s => s.gamesPlayed >= 50,
  },
  {
    id: 'games_100', name: 'Centurion', description: 'Play 100 games',
    icon: '\u{1F3C5}', category: 'milestones',
    checkEarned: s => s.gamesPlayed >= 100,
  },
  {
    id: 'longest_road_5', name: 'Road Holder', description: 'Hold longest road in 5 games',
    icon: '\u{1F6A9}', category: 'milestones',
    checkEarned: s => s.timesHadLongestRoad >= 5,
  },
  {
    id: 'largest_army_5', name: 'Warlord', description: 'Hold largest army in 5 games',
    icon: '\u{1F6E1}\uFE0F', category: 'milestones',
    checkEarned: s => s.timesHadLargestArmy >= 5,
  },
  {
    id: 'high_scorer', name: 'High Scorer', description: 'Reach 12+ victory points in a game',
    icon: '\u{1F4C8}', category: 'milestones',
    checkEarned: s => s.highestVP >= 12,
  },

  // ── Mastery ───────────────────────────────────────────
  {
    id: 'road_king', name: 'Road King', description: 'Build a road of length 10 or more',
    icon: '\u{1F6E3}\uFE0F', category: 'mastery',
    checkEarned: s => s.longestRoadEver >= 10,
  },
  {
    id: 'road_emperor', name: 'Road Emperor', description: 'Build a road of length 13 or more',
    icon: '\u{1F3C1}', category: 'mastery',
    checkEarned: s => s.longestRoadEver >= 13,
  },
  {
    id: 'knight_master', name: 'Knight Master', description: 'Play 50 knights across all games',
    icon: '\u{1F5E1}\uFE0F', category: 'mastery',
    checkEarned: s => s.totalKnightsPlayed >= 50,
  },
  {
    id: 'perfect_game', name: 'Perfect Game', description: 'Win with 15+ victory points',
    icon: '\u{1F48E}', category: 'mastery',
    checkEarned: s => s.recentGames.some(g => g.won && g.finalVP >= 15),
  },
  {
    id: 'collector', name: 'Badge Collector', description: 'Earn 10 badges',
    icon: '\u{1F4DA}', category: 'mastery',
    checkEarned: s => s.badges.length >= 10,
  },
  {
    id: 'completionist', name: 'Completionist', description: 'Earn 20 badges',
    icon: '\u{1F30D}', category: 'mastery',
    checkEarned: s => s.badges.length >= 20,
  },
];

export function getBadgeById(id: string): BadgeDefinition | undefined {
  return BADGES.find(b => b.id === id);
}
