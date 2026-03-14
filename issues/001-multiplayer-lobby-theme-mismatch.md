# Issue #1: Multiplayer Lobby Page Theme Does Not Match Rest of App

## Summary

The multiplayer Game Lobby page (`src/GameLobby.tsx`) uses a completely different color scheme and styling from the rest of the application. The Landing Page and game board use a warm, rustic "outback" theme with earthy tones, serif fonts, and parchment-like styling, while the Game Lobby uses a cold blue/dark tech-style theme with sans-serif fonts.

## Current Behavior

**Landing Page theme** (`src/LandingPage.tsx`):
- Background: warm dark browns (`#1a1008`, `#2a1a0e`)
- Accent: gold (`#d4a020`, `#ffd700`)
- Text: cream/parchment (`#f0e0c8`, `#d2b48c`)
- Font: `'Georgia', 'Palatino', serif`
- Borders: wood tones (`#6b4a18`)
- Buttons: wood gradients with gold accents

**Game Lobby theme** (`src/GameLobby.tsx`):
- Background: cold dark blue (`#0d1117`, `#0a1929`)
- Accent: bright gold (`#ffd700`)
- Text: generic white (`#f0f0f0`)
- Font: `'Segoe UI', system-ui, sans-serif`
- Borders: blue-gray (`#2a4a6a`)
- Buttons: blue-tinted dark (`#1e3a5a`)

## Expected Behavior

The Game Lobby should adopt the same rustic, warm, earthy theme as the Landing Page for a cohesive visual experience. This includes:
- Using the same `COLORS` object from `LandingPage.tsx`
- Matching font family (`Georgia`, `Palatino`, serif)
- Using wood-tone gradients for backgrounds and buttons
- Parchment/cream text colors
- Wood-brown borders instead of blue-gray

## Files to Modify

- `src/GameLobby.tsx` — Replace `COLORS` object and update all inline styles

## Priority

Medium — Visual consistency issue, no functional impact.
