# Settlers of Catan - Web Game Specification

## Project Overview
- **Name:** Settlers of Catan (Web)
- **Type:** Turn-based strategy board game
- **Core:** Full Catan rules + Seafarers expansion
- **Players:** 1 human vs 3 AI opponents
- **Platform:** Browser-based (React + Vite)

## Game Rules (Full Implementation)

### Core Catan
1. **Board Setup**
   - 19 hexagonal tiles (resources): 4 ore, 4 wheat, 4 wood, 4 sheep, 3 brick, (desert +robber)
   - Numbers on tiles (2-12, excluding 7)
   - 4 players (human + 3 AI) at corners
   - Each player starts with 2 settlements + roads

2. **Resources**
   - Brick → roads (1 brick, 1 wood → 1 road)
   - Ore → settlements (1 ore, 1 wheat, 1 brick → 1 settlement)
   - Wheat → settlements + cities (1 wheat, 1 sheep, 1 wood → 1 settlement)
   - Sheep → development cards

3. **Turn Structure**
   - Roll dice (2-12), resource produced at matching number locations
   - Build phase: roads, settlements, cities, buy dev cards
   - Trade: with players or ports (3:1 generic, 2:1 specific)
   - End turn

4. **Victory Points** (10 to win)
   - Settlement: 1 VP
   - City: 2 VP
   - Largest Army: 2 VP (3+ knights)
   - Longest Road: 2 VP (5+ roads)
   - Development cards: 1 VP each

5. **Robber**
   - Roll 7 → discard half if 8+ cards, move robber
   - Steal 1 resource from adjacent player

### Seafarers Expansion
1. **Additional Resources**
   - Gold field tiles (wild, any 1 resource)

2. **Ships**
   - Road on water segments
   - Can be built like roads (1 sheep, 1 wood, 1 grain)
   - Connect islands, explore

3. **Exploration**
   - Build ship to discover adjacent water
   - May place settlements on coast (not inland)
   - Gold fields discovered this way

4. **New Victory Points**
   - Island scoring: each island with your longest sea route

5. **Scenarios**
   - Default: "New Island" - build to 13 VP on new island

## UI/UX

### Layout
```
┌─────────────────────────────────────────────────────────┐
│  [Player Stats Bar - resources, cards, VP]             │
├─────────────────────────────────────────────────────────┤
│              [Game Board - Hex Grid]                    │
├─────────────────────────────────────────────────────────┤
│  [Action Panel - Build, Trade, End Turn, Cards]        │
├─────────────────────────────────────────────────────────┤
│  [Chat/Log - Game events, dice rolls, trades]          │
└─────────────────────────────────────────────────────────┘
```

### Visual Style
- **Theme:** Warm, wooden board game aesthetic
- **Colors:** Earth tones (browns, greens, golds)
- **Pieces:** Distinct colors per player (red, blue, white, orange)
- **Animations:** Smooth piece placement, dice roll, resource flow

## Technical Stack
- React 18 + Vite
- TypeScript
- CSS (no framework - keep it light)

## AI Implementation
1. **Evaluation Function**
   - VP count (weighted 1.0)
   - Resource diversity (0.3)
   - Strategic positions (0.2)
2. **Actions Priority**
   - Build settlements at high-probability spots
   - Expand roads toward victory points

## Budget Control
- Use Ollama for code generation where possible
- Claude Code only for complex logic
- Target: <$10 API usage
