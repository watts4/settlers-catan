# Issue #4: AI Slot Selection Only Allows Setting One AI After a Player Joins

## Summary

When a second human player joins the lobby, the host should be able to mark the remaining two empty slots as AI. However, after marking one slot as AI, the UI appears to prevent marking the second slot. The game ultimately starts correctly with 2 humans + 2 AI (likely because the game start logic fills empty slots with AI by default), but the lobby UI behavior is confusing and feels broken.

## Steps to Reproduce

1. Host creates a multiplayer game (Host occupies slot 0)
2. A second player joins (occupies slot 1)
3. Two slots remain empty (slots 2 and 3), each showing a "🤖 Mark as AI" button
4. Host clicks "Mark as AI" on slot 2 — it works, slot 2 shows as AI
5. Host tries to click "Mark as AI" on slot 3 — the button appears to not work or the UI doesn't update properly
6. Host starts the game — the game starts correctly with all 4 players (2 human + 2 AI)

## Likely Root Cause

In `src/GameLobby.tsx`, the `markSlotAsAI()` function (line 75) writes to Firebase. The issue may be a race condition where:
- The first `markSlotAsAI` call updates `roomData.players` in Firebase
- Before the Firestore listener updates the local `roomData`, the second call uses stale player data
- The second update may overwrite the first AI addition because it spreads from the old `roomData.players` array

Specifically at line 88:
```tsx
const updatedPlayers = existing
  ? roomData.players.map(...)
  : [...roomData.players, aiPlayer];
```

If two rapid calls both use the same `roomData.players` snapshot, the second call's `[...roomData.players, aiPlayer]` won't include the first AI player, effectively overwriting it.

## Suggested Fix

- Use a Firestore transaction or `arrayUnion` to avoid overwriting concurrent updates
- Or add optimistic local state to prevent the race condition
- Or disable the second "Mark as AI" button while the first update is in flight (add a loading/pending state)

## Files to Investigate

- `src/GameLobby.tsx` — `markSlotAsAI()` function (lines 75-94)
- `src/useGameRoom.ts` — Firestore listener and player data management
- `src/gameState.ts` — `createInitialGameState()` to understand how empty slots are handled at game start

## Priority

Medium — The game works correctly in the end, but the lobby UX is confusing and makes it seem like the feature is broken.
