import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserStats, GameRecord } from './types';
import { BADGES } from './badges';

const COLLECTION = 'userStats';

export function createEmptyStats(uid: string, displayName: string, photoURL: string | null): UserStats {
  return {
    uid, displayName, photoURL,
    gamesPlayed: 0, gamesWon: 0, gamesLost: 0,
    currentWinStreak: 0, bestWinStreak: 0,
    totalSettlementsBuilt: 0, totalCitiesBuilt: 0, totalRoadsBuilt: 0,
    totalDevCardsBought: 0, totalDevCardsPlayed: 0, totalKnightsPlayed: 0,
    timesHadLongestRoad: 0, timesHadLargestArmy: 0, longestRoadEver: 0,
    gamesExhaustedSettlements: 0, gamesExhaustedCities: 0, gamesExhaustedRoads: 0,
    winsByStrategy: { balanced: 0, road_warrior: 0, army_commander: 0, dominator: 0, pure_builder: 0, dev_card_heavy: 0 },
    highestVP: 0, totalVPAccumulated: 0,
    badges: [], recentGames: [],
    firstGameAt: 0, lastGameAt: 0,
  };
}

export async function getUserStats(uid: string): Promise<UserStats | null> {
  const snap = await getDoc(doc(db, COLLECTION, uid));
  return snap.exists() ? (snap.data() as UserStats) : null;
}

export async function recordGameAndUpdateStats(
  uid: string, displayName: string, photoURL: string | null, record: GameRecord,
): Promise<UserStats> {
  let stats = await getUserStats(uid) ?? createEmptyStats(uid, displayName, photoURL);
  stats.displayName = displayName;
  stats.photoURL = photoURL;
  stats.gamesPlayed++;
  if (record.won) {
    stats.gamesWon++;
    stats.currentWinStreak++;
    stats.bestWinStreak = Math.max(stats.bestWinStreak, stats.currentWinStreak);
  } else {
    stats.gamesLost++;
    stats.currentWinStreak = 0;
  }
  stats.totalSettlementsBuilt += record.settlementsBuilt;
  stats.totalCitiesBuilt += record.citiesBuilt;
  stats.totalRoadsBuilt += record.roadsBuilt;
  stats.totalDevCardsBought += record.devCardsBought;
  stats.totalDevCardsPlayed += record.devCardsPlayed;
  stats.totalKnightsPlayed += record.knightsPlayed;
  if (record.hadLongestRoad) stats.timesHadLongestRoad++;
  if (record.hadLargestArmy) stats.timesHadLargestArmy++;
  stats.longestRoadEver = Math.max(stats.longestRoadEver, record.longestRoadLength);
  if (record.exhaustedSettlements) stats.gamesExhaustedSettlements++;
  if (record.exhaustedCities) stats.gamesExhaustedCities++;
  if (record.exhaustedRoads) stats.gamesExhaustedRoads++;
  if (record.won && record.winStrategy) stats.winsByStrategy[record.winStrategy]++;
  stats.highestVP = Math.max(stats.highestVP, record.finalVP);
  stats.totalVPAccumulated += record.finalVP;
  stats.recentGames = [record, ...stats.recentGames].slice(0, 50);
  if (!stats.firstGameAt) stats.firstGameAt = record.date;
  stats.lastGameAt = record.date;
  // Check for new badges
  const earnedIds = new Set(stats.badges.map(b => b.id));
  for (const badge of BADGES) {
    if (!earnedIds.has(badge.id) && badge.checkEarned(stats)) {
      stats.badges.push({ id: badge.id, earnedAt: Date.now() });
    }
  }
  await setDoc(doc(db, COLLECTION, uid), stats);
  return stats;
}
