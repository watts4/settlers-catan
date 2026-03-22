# Settlers of Catan

A browser-based implementation of Settlers of Catan with the Seafarers expansion. Play as one human against 3 AI opponents on a procedurally generated board.

## Play

Open `index.html` in a modern browser, or visit the [live version](https://watts4.github.io/settlers-catan/) once deployed.

## Features

- **Full Catan rules** — dice rolls, resource production, building, trading, development cards
- **Seafarers expansion** — ships, gold fields, island exploration, multi-island scenarios
- **3 AI opponents** — automated players that collect resources and build toward victory
- **Port trading** — 3:1 generic and 2:1 resource-specific harbor ports
- **Robber mechanics** — 7 rolls trigger discard and theft
- **Victory tracking** — settlements, cities, Largest Army, Longest Road, VP cards (10 to win)

## Stack

- React + TypeScript (Vite)
- Firebase (hosting + Firestore)

## Run Locally

```bash
npm install
npm run dev
```

## Build & Deploy

```bash
npm run build
firebase deploy
```
