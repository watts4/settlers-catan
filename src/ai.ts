// AI for Settlers of Catan - smart strategic play

import type { GameState, Resource, Vertex, Edge } from './types';
import {
  canAfford, BUILD_COSTS, deductResources,
  addLog, getPlayersAdjacentToHex, stealResource,
  moveRobber, getTotalResources,
  updateLongestRoad, updateLargestArmy, calculateVP, checkWinCondition,
} from './gameState';
import { hexCenterPx, HEX_SIZE } from './board';

// Probability weight for each dice number (out of 36 combinations)
const PROB_WEIGHT: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
};

function distSq(ax: number, ay: number, bx: number, by: number) {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

function edgesShareEndpoint(e1: Edge, e2: Edge): boolean {
  const eps = 16;
  return (
    distSq(e1.x1, e1.y1, e2.x1, e2.y1) < eps ||
    distSq(e1.x1, e1.y1, e2.x2, e2.y2) < eps ||
    distSq(e1.x2, e1.y2, e2.x1, e2.y1) < eps ||
    distSq(e1.x2, e1.y2, e2.x2, e2.y2) < eps
  );
}

// Score a vertex by adjacent hex probabilities + resource diversity
function scoreVertex(state: GameState, vertex: Vertex): number {
  const adjacentHexes = state.board.hexes.filter(hex => {
    const { cx, cy } = hexCenterPx(hex.q, hex.r);
    return Math.sqrt(distSq(vertex.x, vertex.y, cx, cy)) <= HEX_SIZE + 2;
  });

  let score = 0;
  const resources = new Set<string>();

  for (const hex of adjacentHexes) {
    if (!hex.number || hex.resource === 'desert') continue;
    score += PROB_WEIGHT[hex.number] || 0;
    resources.add(hex.resource);
  }

  // Bonus for resource diversity (up to +6)
  score += resources.size * 2;
  return score;
}

// Get all valid vertices for setup placement (distance rule)
function getValidSetupVertices(state: GameState): Vertex[] {
  return state.board.vertices.filter(v => {
    if (Object.values(v.settlements).some(s => s)) return false;
    for (const other of state.board.vertices) {
      if (!Object.values(other.settlements).some(s => s)) continue;
      if (distSq(v.x, v.y, other.x, other.y) < (HEX_SIZE * 1.1) ** 2) return false;
    }
    return true;
  });
}

// Best vertex for AI setup settlement — pick top-scored with slight randomness
export function aiBestSetupSettlement(state: GameState): string | null {
  const valid = getValidSetupVertices(state);
  if (valid.length === 0) return null;

  const scored = valid.map(v => ({ v, score: scoreVertex(state, v) }));
  scored.sort((a, b) => b.score - a.score);

  // Pick from top 3 for variety so games don't feel identical
  const top = scored.slice(0, Math.min(3, scored.length));
  return top[Math.floor(Math.random() * top.length)].v.id;
}

// Best road for AI setup — aim toward highest-scoring unoccupied vertex
export function aiBestSetupRoad(state: GameState): string | null {
  const lastId = state.setupLastSettlementVertexId;
  if (!lastId) return null;
  const vertex = state.board.vertices.find(v => v.id === lastId);
  if (!vertex) return null;

  const valid = state.board.edges.filter(e => {
    if (Object.values(e.roads).some(r => r)) return false;
    return distSq(vertex.x, vertex.y, e.x1, e.y1) < 16 ||
           distSq(vertex.x, vertex.y, e.x2, e.y2) < 16;
  });

  if (valid.length === 0) return null;

  const scored = valid.map(edge => {
    const isNear1 = distSq(vertex.x, vertex.y, edge.x1, edge.y1) < 16;
    const farX = isNear1 ? edge.x2 : edge.x1;
    const farY = isNear1 ? edge.y2 : edge.y1;

    const nearby = state.board.vertices.filter(v =>
      distSq(v.x, v.y, farX, farY) < (HEX_SIZE * 1.5) ** 2 &&
      !Object.values(v.settlements).some(s => s)
    );
    const bestScore = nearby.length > 0
      ? Math.max(...nearby.map(v => scoreVertex(state, v)))
      : 0;
    return { edge, score: bestScore };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].edge.id;
}

// Valid settlement spots during playing phase (must be adjacent to own road)
function getValidPlayingSettlements(state: GameState): Vertex[] {
  const playerId = state.currentPlayer.toString();
  return state.board.vertices.filter(v => {
    if (Object.values(v.settlements).some(s => s)) return false;
    for (const other of state.board.vertices) {
      if (!Object.values(other.settlements).some(s => s)) continue;
      if (distSq(v.x, v.y, other.x, other.y) < (HEX_SIZE * 1.1) ** 2) return false;
    }
    return state.board.edges.some(e => {
      if (!e.roads[playerId]) return false;
      return distSq(v.x, v.y, e.x1, e.y1) < 16 || distSq(v.x, v.y, e.x2, e.y2) < 16;
    });
  });
}

// Valid road edges during playing phase
function getValidPlayingRoads(state: GameState): Edge[] {
  const playerId = state.currentPlayer.toString();
  return state.board.edges.filter(e => {
    if (Object.values(e.roads).some(r => r)) return false;
    const endpoints = state.board.vertices.filter(
      v => distSq(v.x, v.y, e.x1, e.y1) < 16 || distSq(v.x, v.y, e.x2, e.y2) < 16
    );
    for (const v of endpoints) { if (v.settlements[playerId]) return true; }
    for (const other of state.board.edges) {
      if (!other.roads[playerId]) continue;
      if (edgesShareEndpoint(e, other)) return true;
    }
    return false;
  });
}

// Own settlements that can be upgraded to cities
function getCityTargets(state: GameState): Vertex[] {
  const playerId = state.currentPlayer.toString();
  return state.board.vertices.filter(v => v.settlements[playerId] === 'settlement');
}

// Move robber to hex that hurts opponents most (high prob + opponent cities/settlements)
function aiMoveRobber(state: GameState): void {
  const playerId = state.currentPlayer;
  let bestHex = state.board.hexes.find(h => h.resource !== 'desert' && h.number) || state.board.hexes[0];
  let bestScore = -1;

  for (const hex of state.board.hexes) {
    if (hex.resource === 'desert' || !hex.number || hex.hasRobber) continue;

    const { cx, cy } = hexCenterPx(hex.q, hex.r);
    const adjacentVertices = state.board.vertices.filter(v => {
      const dx = v.x - cx, dy = v.y - cy;
      return Math.sqrt(dx * dx + dy * dy) <= HEX_SIZE + 2;
    });

    let opponentScore = 0;
    let hasOwn = false;

    for (const v of adjacentVertices) {
      for (const [pid, type] of Object.entries(v.settlements)) {
        if (!type) continue;
        if (parseInt(pid) === playerId) { hasOwn = true; break; }
        // Weight by piece value × probability
        opponentScore += (type === 'city' ? 2 : 1) * (PROB_WEIGHT[hex.number] || 0);
      }
      if (hasOwn) break;
    }

    if (hasOwn) continue;

    if (opponentScore > bestScore) {
      bestScore = opponentScore;
      bestHex = hex;
    }
  }

  moveRobber(state, bestHex.id);

  const adjacent = getPlayersAdjacentToHex(state, bestHex);
  if (adjacent.length > 0) {
    // Steal from player with most resources
    const target = adjacent.reduce((a, b) =>
      getTotalResources(b) > getTotalResources(a) ? b : a
    );
    stealResource(state, target.id);
    addLog(state, `${state.players[playerId].name} moved robber and stole from ${target.name}`);
  } else {
    addLog(state, `${state.players[playerId].name} moved the robber`);
  }
}

// Try to trade 4:1 with bank for a needed resource
function tryBankTrade(state: GameState, need: Resource): boolean {
  const player = state.players[state.currentPlayer];
  const resources: Resource[] = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

  for (const give of resources) {
    if (give === need) continue;
    if ((player.resources[give] || 0) >= 4) {
      player.resources[give] = (player.resources[give] || 0) - 4;
      player.resources[need] = (player.resources[need] || 0) + 1;
      addLog(state, `${player.name} traded 4 ${give} → 1 ${need} with bank`);
      return true;
    }
  }
  return false;
}

// Should the AI play a knight card this turn?
function shouldPlayKnight(state: GameState): boolean {
  const player = state.players[state.currentPlayer];
  if (!player.devCards.includes('knight')) return false;

  // Play knight to take or maintain Largest Army
  const currentLargest = state.largestArmyHolder;
  if (currentLargest === null && player.knightsPlayed >= 2) return true;
  if (currentLargest !== null && currentLargest !== state.currentPlayer) {
    const holderKnights = state.players[currentLargest].knightsPlayed;
    if (player.knightsPlayed >= holderKnights) return true;
  }

  // Play knight if robber is on our hex
  const myId = state.currentPlayer.toString();
  const robberHex = state.board.hexes.find(h => h.hasRobber);
  if (robberHex) {
    const { cx, cy } = hexCenterPx(robberHex.q, robberHex.r);
    const onOurHex = state.board.vertices.some(v => {
      if (!v.settlements[myId]) return false;
      const dx = v.x - cx, dy = v.y - cy;
      return Math.sqrt(dx * dx + dy * dy) <= HEX_SIZE + 2;
    });
    if (onOurHex) return true;
  }

  return false;
}

/**
 * Main AI decision function.
 * Called after dice have been rolled and resources distributed.
 * Returns a new GameState with all AI actions applied + turn advanced.
 */
export function aiDoFullTurn(state: GameState): GameState {
  // Deep clone so we can freely mutate
  const s: GameState = JSON.parse(JSON.stringify(state));
  const pid = s.currentPlayer;
  const player = s.players[pid];
  const diceSum = s.dice ? s.dice[0] + s.dice[1] : 0;

  // --- Handle robber if 7 was rolled ---
  if (diceSum === 7) {
    aiMoveRobber(s);
  }

  // --- Play knight if beneficial (can play before OR after rolling in Catan;
  //     here we play it post-roll since dice are already set) ---
  if (shouldPlayKnight(s)) {
    const idx = player.devCards.indexOf('knight');
    player.devCards.splice(idx, 1);
    player.knightsPlayed++;
    updateLargestArmy(s);
    aiMoveRobber(s);
    addLog(s, `${player.name} played a Knight`);
  }

  // --- Build loop: keep building most valuable thing until stuck ---
  const MAX_ITERATIONS = 15;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const cityTargets = getCityTargets(s);
    const settlementTargets = getValidPlayingSettlements(s);
    const roadTargets = getValidPlayingRoads(s);

    // Priority 1: Upgrade settlement to city
    if (canAfford(player, BUILD_COSTS.city) && cityTargets.length > 0 && player.pieces.cities > 0) {
      const best = cityTargets.reduce((a, b) =>
        scoreVertex(s, a) >= scoreVertex(s, b) ? a : b
      );
      best.settlements[pid.toString()] = 'city';
      player.pieces.cities--;
      player.pieces.settlements++; // settlement piece returned to supply
      deductResources(player, BUILD_COSTS.city);
      addLog(s, `${player.name} upgraded to a city`);
      updateLongestRoad(s);
      continue;
    }

    // Priority 2: Build settlement
    if (canAfford(player, BUILD_COSTS.settlement) && settlementTargets.length > 0 && player.pieces.settlements > 0) {
      const best = settlementTargets.reduce((a, b) =>
        scoreVertex(s, a) >= scoreVertex(s, b) ? a : b
      );
      best.settlements[pid.toString()] = 'settlement';
      player.pieces.settlements--;
      deductResources(player, BUILD_COSTS.settlement);
      addLog(s, `${player.name} built a settlement`);
      continue;
    }

    // Priority 3: Build road (only if it opens expansion opportunities)
    if (canAfford(player, BUILD_COSTS.road) && roadTargets.length > 0 && player.pieces.roads > 0) {
      // Only build road if we need expansion (no settlement spots, or enough resources to spare)
      const needsExpansion = settlementTargets.length === 0;
      const hasSurplusResources = getTotalResources(player) >= 7;

      if (needsExpansion || hasSurplusResources) {
        // Score each road by how close its far endpoint is to the best unoccupied vertex
        const unoccupied = s.board.vertices.filter(v =>
          !Object.values(v.settlements).some(t => t)
        );

        const scored = roadTargets.map(edge => {
          const d1 = distSq(0, 0, edge.x1, edge.y1);
          const d2 = distSq(0, 0, edge.x2, edge.y2);
          const farX = d1 > d2 ? edge.x1 : edge.x2;
          const farY = d1 > d2 ? edge.y1 : edge.y2;
          const nearby = unoccupied.filter(v =>
            distSq(v.x, v.y, farX, farY) < (HEX_SIZE * 2.5) ** 2
          );
          const bestScore = nearby.length > 0
            ? Math.max(...nearby.map(v => scoreVertex(s, v)))
            : 0;
          return { edge, score: bestScore };
        });
        scored.sort((a, b) => b.score - a.score);

        const bestRoad = scored[0].edge;
        bestRoad.roads[pid.toString()] = 'road';
        player.pieces.roads--;
        deductResources(player, BUILD_COSTS.road);
        addLog(s, `${player.name} built a road`);
        updateLongestRoad(s);
        continue;
      }
    }

    // Priority 4: Buy development card
    if (canAfford(player, BUILD_COSTS.devCard) && s.devCardDeck.length > 0) {
      const card = s.devCardDeck.pop()!;
      player.devCards.push(card);
      deductResources(player, BUILD_COSTS.devCard);
      addLog(s, `${player.name} bought a development card`);
      // Note: can't play a card bought this same turn (Catan rule)
      continue;
    }

    // --- Bank trades: try to get within reach of something useful ---
    let traded = false;

    // Trade toward city if we have settlement targets
    if (getCityTargets(s).length > 0) {
      if ((player.resources.wheat || 0) < 2 && tryBankTrade(s, 'wheat')) { traded = true; }
      else if ((player.resources.ore || 0) < 3 && tryBankTrade(s, 'ore')) { traded = true; }
    }

    // Trade toward settlement
    if (!traded && getValidPlayingSettlements(s).length > 0) {
      const settNeeds = (['wood', 'brick', 'wheat', 'sheep'] as Resource[])
        .filter(r => (player.resources[r] || 0) === 0);
      for (const need of settNeeds) {
        if (tryBankTrade(s, need)) { traded = true; break; }
      }
    }

    // Trade toward road if stuck with no settlement spots
    if (!traded && getValidPlayingSettlements(s).length === 0 && getValidPlayingRoads(s).length > 0) {
      const roadNeeds = (['wood', 'brick'] as Resource[])
        .filter(r => (player.resources[r] || 0) === 0);
      for (const need of roadNeeds) {
        if (tryBankTrade(s, need)) { traded = true; break; }
      }
    }

    if (!traded) break; // Nothing left to do
  }

  // Update VP for all players
  for (const p of s.players) {
    p.victoryPoints = calculateVP(p, s);
  }

  // Check win condition
  const winner = checkWinCondition(s);
  if (winner !== null) {
    s.winner = winner;
    s.phase = 'gameOver';
    return s;
  }

  // End turn
  s.currentPlayer = (s.currentPlayer + 1) % 4;
  s.turn++;
  s.dice = null;

  return s;
}
