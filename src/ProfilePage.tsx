import { useState, useEffect } from 'react';
import { getUserStats } from './stats/statsService';
import { BADGES } from './stats/badges';
import type { UserStats, BadgeDefinition, WinStrategy } from './stats/types';

interface ProfilePageProps {
  uid: string;
  displayName: string;
  photoURL: string | null;
  onBack: () => void;
}

const COLORS = {
  bg: '#1a1008', bgLight: '#2a1a0e', cardBg: 'rgba(60, 40, 20, 0.7)',
  cardBorder: '#6b4a18', gold: '#d4a020', goldBright: '#ffd700',
  cream: '#f0e0c8', parchment: '#d2b48c', muted: '#9a8a6a',
  red: '#8b2020', redBright: '#c0392b', green: '#4a7a30', greenBright: '#5d9b3a',
  blue: '#2a5a8a', orange: '#c87820', wood: '#6b3410', woodLight: '#8b5e2f', woodDark: '#3a1a08',
};

const FONT = "'Georgia', 'Palatino', serif";

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

const STRATEGY_LABELS: Record<WinStrategy, { label: string; color: string }> = {
  balanced: { label: 'Balanced', color: COLORS.gold },
  road_warrior: { label: 'Road Warrior', color: COLORS.orange },
  army_commander: { label: 'Army Commander', color: COLORS.red },
  dominator: { label: 'Dominator', color: COLORS.redBright },
  pure_builder: { label: 'Pure Builder', color: COLORS.green },
  dev_card_heavy: { label: 'Dev Card Heavy', color: COLORS.blue },
};

const CATEGORY_LABELS: Record<string, string> = {
  wins: 'Victories',
  building: 'Building',
  strategy: 'Strategy',
  milestones: 'Milestones',
  mastery: 'Mastery',
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ProfilePage({ uid, displayName, photoURL, onBack }: ProfilePageProps) {
  const [stats, setStats] = useState<UserStats | null | undefined>(undefined);
  const isMobile = useIsMobile();

  useEffect(() => {
    getUserStats(uid)
      .then(s => setStats(s))
      .catch(err => {
        console.error('Failed to load profile stats:', err);
        setStats(null);
      });
  }, [uid]);

  const pageStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: `linear-gradient(135deg, ${COLORS.bg} 0%, ${COLORS.bgLight} 50%, ${COLORS.woodDark} 100%)`,
    fontFamily: FONT,
    color: COLORS.cream,
    padding: isMobile ? '12px' : '24px 40px',
    overflowY: 'auto',
  };

  const cardStyle: React.CSSProperties = {
    background: COLORS.cardBg,
    border: `1px solid ${COLORS.cardBorder}`,
    borderRadius: 12,
    padding: isMobile ? '14px' : '20px',
    marginBottom: 20,
  };

  const headingStyle: React.CSSProperties = {
    color: COLORS.gold,
    fontSize: isMobile ? 18 : 22,
    fontWeight: 'bold',
    marginBottom: 14,
    borderBottom: `1px solid ${COLORS.cardBorder}`,
    paddingBottom: 8,
  };

  // Loading state
  if (stats === undefined) {
    return (
      <div style={{ ...pageStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16, animation: 'spin 1s linear infinite' }}>&#x2699;&#xFE0F;</div>
          <div style={{ color: COLORS.parchment, fontSize: 18 }}>Loading profile...</div>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // No games played
  if (stats === null) {
    return (
      <div style={pageStyle}>
        <button onClick={onBack} style={backBtnStyle}>{'\u2190'} Back</button>
        <div style={{ textAlign: 'center', marginTop: 80 }}>
          <div style={{ fontSize: 60, marginBottom: 20 }}>&#x1F3B2;</div>
          <h2 style={{ color: COLORS.gold, fontSize: 24, marginBottom: 12 }}>No Games Played Yet</h2>
          <p style={{ color: COLORS.parchment, fontSize: 16 }}>
            Play your first game of Catan to start tracking your stats and earning badges!
          </p>
        </div>
      </div>
    );
  }

  const winRate = stats.gamesPlayed > 0 ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : 0;
  const avgVP = stats.gamesPlayed > 0 ? (stats.totalVPAccumulated / stats.gamesPlayed).toFixed(1) : '0';
  const earnedBadgeIds = new Set(stats.badges.map(b => b.id));
  const maxStrategyWins = Math.max(1, ...Object.values(stats.winsByStrategy));

  return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={backBtnStyle}>{'\u2190'}</button>
        <h1 style={{ color: COLORS.goldBright, fontSize: isMobile ? 22 : 30, margin: 0, flex: 1 }}>Player Profile</h1>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        {photoURL ? (
          <img src={photoURL} alt="" style={{ width: 56, height: 56, borderRadius: '50%', border: `2px solid ${COLORS.gold}` }} />
        ) : (
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: COLORS.wood, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, border: `2px solid ${COLORS.gold}` }}>
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 'bold', color: COLORS.cream }}>{displayName}</div>
          <div style={{ color: COLORS.muted, fontSize: 13 }}>
            Playing since {stats.firstGameAt ? formatDate(stats.firstGameAt) : 'N/A'}
          </div>
        </div>
      </div>

      {/* Overview Stats */}
      <div style={cardStyle}>
        <h2 style={headingStyle}>Overview</h2>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 12 }}>
          <StatBox label="Games Played" value={stats.gamesPlayed} />
          <StatBox label="Games Won" value={stats.gamesWon} color={COLORS.greenBright} />
          <StatBox label="Games Lost" value={stats.gamesLost} color={COLORS.redBright} />
          <StatBox label="Win Rate" value={`${winRate}%`} color={winRate >= 50 ? COLORS.greenBright : COLORS.orange} />
          <StatBox label="Current Streak" value={stats.currentWinStreak} color={COLORS.gold} />
          <StatBox label="Best Streak" value={stats.bestWinStreak} color={COLORS.goldBright} />
          <StatBox label="Highest VP" value={stats.highestVP} color={COLORS.goldBright} />
          <StatBox label="Avg VP" value={avgVP} />
        </div>
      </div>

      {/* Building Stats */}
      <div style={cardStyle}>
        <h2 style={headingStyle}>Building Stats</h2>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: 12 }}>
          <StatBox label="Settlements Built" value={stats.totalSettlementsBuilt} icon="&#x1F3E0;" />
          <StatBox label="Cities Built" value={stats.totalCitiesBuilt} icon="&#x1F3D9;&#xFE0F;" />
          <StatBox label="Roads Built" value={stats.totalRoadsBuilt} icon="&#x1F6E4;&#xFE0F;" />
          <StatBox label="All Settlements Used" value={`${stats.gamesExhaustedSettlements}x`} />
          <StatBox label="All Cities Used" value={`${stats.gamesExhaustedCities}x`} />
          <StatBox label="All Roads Used" value={`${stats.gamesExhaustedRoads}x`} />
        </div>
      </div>

      {/* Combat & Dev Cards */}
      <div style={cardStyle}>
        <h2 style={headingStyle}>Combat & Development</h2>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: 12 }}>
          <StatBox label="Dev Cards Bought" value={stats.totalDevCardsBought} icon="&#x1F0CF;" />
          <StatBox label="Dev Cards Played" value={stats.totalDevCardsPlayed} />
          <StatBox label="Knights Played" value={stats.totalKnightsPlayed} icon="&#x2694;&#xFE0F;" />
          <StatBox label="Longest Road Held" value={`${stats.timesHadLongestRoad}x`} />
          <StatBox label="Largest Army Held" value={`${stats.timesHadLargestArmy}x`} />
          <StatBox label="Longest Road Ever" value={stats.longestRoadEver} color={COLORS.goldBright} />
        </div>
      </div>

      {/* Win Strategies */}
      <div style={cardStyle}>
        <h2 style={headingStyle}>Win Strategies</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(Object.entries(STRATEGY_LABELS) as [WinStrategy, { label: string; color: string }][]).map(([key, { label, color }]) => {
            const count = stats.winsByStrategy[key];
            const pct = (count / maxStrategyWins) * 100;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: isMobile ? 100 : 140, fontSize: 13, color: COLORS.parchment, flexShrink: 0, textAlign: 'right' }}>{label}</div>
                <div style={{ flex: 1, height: 22, background: COLORS.woodDark, borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 6, transition: 'width 0.5s ease', minWidth: count > 0 ? 20 : 0 }} />
                </div>
                <div style={{ width: 30, fontSize: 14, color: COLORS.cream, textAlign: 'right' }}>{count}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Badges */}
      <div style={cardStyle}>
        <h2 style={headingStyle}>Badges ({stats.badges.length} / {BADGES.length})</h2>
        {Object.entries(CATEGORY_LABELS).map(([cat, catLabel]) => {
          const catBadges = BADGES.filter(b => b.category === cat);
          if (catBadges.length === 0) return null;
          return (
            <div key={cat} style={{ marginBottom: 20 }}>
              <h3 style={{ color: COLORS.parchment, fontSize: 15, marginBottom: 10, fontWeight: 'normal', textTransform: 'uppercase', letterSpacing: 1.5 }}>{catLabel}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10 }}>
                {catBadges.map(badge => {
                  const earned = earnedBadgeIds.has(badge.id);
                  const earnedBadge = stats.badges.find(b => b.id === badge.id);
                  return (
                    <BadgeCard key={badge.id} badge={badge} earned={earned} earnedAt={earnedBadge?.earnedAt ?? null} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent Games */}
      <div style={cardStyle}>
        <h2 style={headingStyle}>Recent Games</h2>
        {stats.recentGames.length === 0 ? (
          <div style={{ color: COLORS.muted, textAlign: 'center', padding: 20 }}>No games recorded yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: isMobile ? 12 : 14 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.cardBorder}` }}>
                  {['Date', 'Result', 'VP', 'S/C/R', 'Achievements', 'Strategy'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 6px', color: COLORS.parchment, fontWeight: 'normal', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.recentGames.slice(0, 20).map((g, i) => {
                  const achievements: string[] = [];
                  if (g.hadLongestRoad) achievements.push('LR');
                  if (g.hadLargestArmy) achievements.push('LA');
                  if (g.exhaustedSettlements) achievements.push('5S');
                  if (g.exhaustedCities) achievements.push('4C');
                  if (g.exhaustedRoads) achievements.push('15R');
                  return (
                    <tr key={g.gameId || i} style={{ borderBottom: `1px solid ${COLORS.woodDark}` }}>
                      <td style={{ padding: '8px 6px', color: COLORS.muted, whiteSpace: 'nowrap' }}>{formatDate(g.date)}</td>
                      <td style={{ padding: '8px 6px' }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 'bold',
                          background: g.won ? COLORS.green : COLORS.red,
                          color: COLORS.cream,
                        }}>
                          {g.won ? 'WIN' : 'LOSS'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 6px', color: COLORS.goldBright, fontWeight: 'bold' }}>{g.finalVP}</td>
                      <td style={{ padding: '8px 6px', color: COLORS.cream }}>{g.settlementsBuilt}/{g.citiesBuilt}/{g.roadsBuilt}</td>
                      <td style={{ padding: '8px 6px', color: COLORS.orange }}>{achievements.join(', ') || '-'}</td>
                      <td style={{ padding: '8px 6px', color: COLORS.parchment, fontSize: 12 }}>
                        {g.winStrategy ? STRATEGY_LABELS[g.winStrategy]?.label ?? g.winStrategy : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, color, icon }: { label: string; value: string | number; color?: string; icon?: string }) {
  return (
    <div style={{
      background: COLORS.woodDark,
      borderRadius: 8,
      padding: '12px 10px',
      textAlign: 'center',
    }}>
      {icon && <div style={{ fontSize: 20, marginBottom: 4 }} dangerouslySetInnerHTML={{ __html: icon }} />}
      <div style={{ fontSize: 22, fontWeight: 'bold', color: color ?? COLORS.cream }}>{value}</div>
      <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function BadgeCard({ badge, earned, earnedAt }: { badge: BadgeDefinition; earned: boolean; earnedAt: number | null }) {
  return (
    <div style={{
      background: earned ? COLORS.woodDark : 'rgba(30, 20, 10, 0.5)',
      border: `1px solid ${earned ? COLORS.gold : COLORS.woodDark}`,
      borderRadius: 8,
      padding: '10px 8px',
      textAlign: 'center',
      opacity: earned ? 1 : 0.5,
      transition: 'opacity 0.2s',
    }}>
      <div style={{ fontSize: 28, marginBottom: 4 }}>{earned ? badge.icon : '\u{1F512}'}</div>
      <div style={{ fontSize: 12, fontWeight: 'bold', color: earned ? COLORS.gold : COLORS.muted, marginBottom: 2 }}>{badge.name}</div>
      <div style={{ fontSize: 10, color: COLORS.muted, lineHeight: 1.3 }}>{badge.description}</div>
      {earned && earnedAt && (
        <div style={{ fontSize: 9, color: COLORS.muted, marginTop: 4 }}>Earned {formatDate(earnedAt)}</div>
      )}
    </div>
  );
}

const backBtnStyle: React.CSSProperties = {
  background: 'none',
  border: `1px solid ${COLORS.cardBorder}`,
  borderRadius: 8,
  color: COLORS.parchment,
  fontSize: 18,
  padding: '6px 14px',
  cursor: 'pointer',
  fontFamily: FONT,
};
