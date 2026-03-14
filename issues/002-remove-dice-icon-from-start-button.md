# Issue #2: Remove Dice Icon from "Start Game" Button

## Summary

The "Start Game" button in the Game Lobby has a dice emoji (🎲) prepended to the text. This should be removed.

## Current Behavior

In `src/GameLobby.tsx` line 365:
```tsx
🎲 Start Game
```

The button renders as: **🎲 Start Game**

## Expected Behavior

The button should simply read: **Start Game** (no emoji/icon).

## Files to Modify

- `src/GameLobby.tsx` line 365 — Remove `🎲 ` from button text

## Priority

Low — Minor UI cleanup.
