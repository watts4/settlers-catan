# Issue #3: Remove Castle Icon from Game Lobby Title

## Summary

The Game Lobby page header displays a castle emoji (🏰) before "Game Lobby". This should be removed.

## Current Behavior

In `src/GameLobby.tsx` line 123:
```tsx
🏰 Game Lobby
```

The title renders as: **🏰 Game Lobby**

## Expected Behavior

The title should simply read: **Game Lobby** (no emoji/icon).

## Files to Modify

- `src/GameLobby.tsx` line 123 — Remove `🏰 ` from heading text

## Priority

Low — Minor UI cleanup.
