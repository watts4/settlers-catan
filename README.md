# Settlers of Catan

Catan in the browser. Play against computer players, or start a room and play
with friends online. Live at https://watts4.github.io/settlers-catan/.

## What's in it

- **The full base game**: setup in snake order, production, the robber and
  discards on a 7, harbours (3:1 and 2:1), all five development cards (14
  knights, 5 victory points, 2 each of Road Building, Year of Plenty and
  Monopoly), Longest Road (broken by settlements) and Largest Army, 19 cards
  of each resource in the bank, winning on your own turn.
- **Computer players** at three levels. Easy, normal and hard win roughly 15%,
  25% and 29% of four-player games against normal players.
- **Online rooms**: create a room, send the link, and empty seats become
  computer players when you start. Someone can also take over a computer's
  seat mid-game.
- **Sound and music**: dice, wooden pieces, coins and a fanfare, all
  synthesised with Web Audio, plus an optional generative tune.
- **Animation**: tumbling 3D dice, cards flying from hexes to hands, pieces
  dropping in, and a moving robber.
- **Options**: friendly robber, 8/10/12 points to win, 2 or 3 opponents, your
  colour, computer speed.
- **Stats and badges** for players signed in with Google.

## Layout

```
src/engine/   rules engine: plain TypeScript, no React, no network
  types.ts      game state and actions (plain JSON, Firestore-safe)
  geometry.ts   hex grid: corners, sides, who touches whom
  board.ts      island generation (6s and 8s never touch)
  rules.ts      questions: where can I build, what does it cost, points
  game.ts       createGame / applyAction: the reducer
  ai.ts         computer players, one move at a time
  rng.ts        seeded dice, so every client agrees
src/ui/       React screens: board (SVG), panels, dialogs, home, lobby
src/audio/    synthesised sound effects and music
src/net/      Firestore rooms: every move is a transaction through the engine
src/stats/    per-player stats and badges
```

Every change to the game goes through `applyAction(state, action)`, which
returns the next state or a reason the move isn't allowed. The screen and the
computer players both use it, and so does every online move, inside a
Firestore transaction.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173/settlers-catan/
npx vitest run       # rules tests + 60 full computer-only games
npx vite-node scripts/balance.ts 200 easy,normal,hard,normal   # win rates
```

Add `?debug` to the URL to get `window.__game` (state, your seat, dispatch) in
the console.

## Deploy

GitHub Pages serves `docs/` from `master`:

```bash
npm run build        # builds into docs/
git add docs && git commit && git push
```

Firestore rules (`firestore.rules`) are shared with the Santa Cruz Vampire RPG
in the `scvampire` project; deploying them replaces that project's whole rule
set, which is why the RPG's collections are listed in the same file.

## Known limits

Online games trust the players in the room. The whole game state, including
hands and the dice seed, sits in the room document, so a player who opens the
browser console could see other hands or send moves for another seat. Fixing
that needs a server to check moves (a Cloud Function).
