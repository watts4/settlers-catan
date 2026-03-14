# Issue #5: Google Sign-In — Current State, Potential, and Feature Request for Stats & Badges

## Summary

This issue documents what Google Sign-In currently does, what it could do, and a feature request for a badge/stats system tied to authenticated accounts.

---

## What Google Sign-In Currently Does

Google Sign-In is implemented via Firebase Authentication (`src/firebase.ts`, `src/LandingPage.tsx`).

**Current functionality:**
1. Shows a "Sign in with Google" button on the Landing Page (line 190-214)
2. Uses `signInWithPopup()` with `GoogleAuthProvider` for OAuth
3. Tracks auth state via `onAuthStateChanged()` — displays user's name/email in the top-right corner
4. Provides a "Sign Out" button when authenticated
5. Stores the user's `uid` in `GameRoomPlayer` when joining multiplayer games

**Current limitations:**
- Signing in is **completely optional** — you can play solo or multiplayer without signing in
- The `uid` is stored but **not used for anything** beyond identification
- Player names are manually entered (not auto-filled from Google profile)
- No persistent data is stored per-user (no stats, no history, no preferences)
- No account-based features exist

---

## What Google Sign-In COULD Do

With Firebase Auth already in place, the infrastructure exists to support:

### 1. Player Stats (per-user, persistent)
Store in Firestore under a `users/{uid}/stats` document:
- Total games played
- Wins / losses / win rate
- Average victory points per game
- Longest road / largest army achievements count
- Resource statistics (most traded, most collected, etc.)
- Games played by player count (2p, 3p, 4p)

### 2. Comparative Leaderboard
- Global leaderboard across all signed-in players
- Stats like: win rate, total wins, average VP, fastest win
- Could be filtered by time period (weekly, monthly, all-time)

### 3. Badge / Achievement System
Possible badges:
- **First Victory** — Win your first game
- **Road Builder** — Achieve Longest Road 10 times
- **General** — Achieve Largest Army 10 times
- **Monopolist** — Successfully play 20 Monopoly dev cards
- **Trader** — Complete 50 trades with other players
- **Domination** — Win with 12+ victory points
- **Speed Settler** — Win in under 15 minutes
- **Veteran** — Play 100 games
- **Social Butterfly** — Play 50 multiplayer games
- **AI Crusher** — Win 25 solo games

### 4. Profile Page
- Display badges, stats, and game history
- Show comparative ranking vs. all players

---

## Feature Request

**Add an optional badge and comparative stats system for signed-in players.**

### Requirements:
1. **Anyone can still play without signing in** — signing in is never required
2. **Signed-in players get stats tracked** — wins, losses, VP averages, achievements
3. **Badge system** — unlock visual badges for milestones (displayed on profile and in-game)
4. **Comparative stats** — see how you rank against other signed-in players (leaderboard)
5. **Non-intrusive** — stats tracking happens silently in the background after games end
6. **Profile accessible from Landing Page** — small avatar/stats button for signed-in users

### Suggested Implementation Approach:
1. Create a Firestore `users/{uid}` collection for player profiles and stats
2. After each game ends, write game results to `users/{uid}/stats` and `users/{uid}/games` sub-collections
3. Create a `PlayerProfile` component showing badges and stats
4. Add a leaderboard component pulling from all user stats
5. Integrate badge display into the game lobby (show badges next to player names)

### Data Model Sketch:
```
users/{uid}:
  displayName: string
  photoURL: string
  createdAt: timestamp
  stats:
    gamesPlayed: number
    wins: number
    longestRoadCount: number
    largestArmyCount: number
    totalVP: number
    badges: string[]  // earned badge IDs

users/{uid}/games/{gameId}:
  date: timestamp
  players: number
  result: 'win' | 'loss'
  vp: number
  hadLongestRoad: boolean
  hadLargestArmy: boolean
```

## Files That Would Need Changes:
- `src/firebase.ts` — Firestore rules and collections setup
- `src/LandingPage.tsx` — Profile button for signed-in users
- `src/App.tsx` — Post-game stats recording
- `src/GameLobby.tsx` — Display badges next to player names
- New files: `src/PlayerProfile.tsx`, `src/StatsService.ts`, `src/badges.ts`

## Priority

Low-Medium — Enhancement feature. Google Sign-In infrastructure already exists, making this feasible without major architectural changes.
