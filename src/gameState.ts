// Game state management for Settlers of Catan

import type { GameState, Player, Resource, Hex, Vertex, Edge } from './types';
import { generateBoard, hexCenterPx, HEX_SIZE } from './board';

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#ecf0f1', '#e67e22']; // red, blue, white (or light gray), orange
const PLAYER_NAMES = ['You', 'Hildeguard', 'Steve', 'Tammy'];

const DEV_CARDS = [
  'knight', 'knight', 'knight', 'knight', 'knight', 'knight', 'knight', 'knight', 'knight',
  'knight', 'knight', 'knight', 'knight', 'knight',
  'road', 'road', 'road', 'road', 'road',
  'plenty', 'plenty', 'plenty', 'plenty',
  'monopoly', 'monopoly', 'monopoly', 'monopoly',
  'victory', 'victory', 'victory', 'victory',
];

export interface PlayerConfig {
  name: string;
  isHuman: boolean;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function createInitialGameState(playerConfigs?: PlayerConfig[]): GameState {
  const { hexes, vertices, edges, ports } = generateBoard();

  // Shuffle dev cards
  const shuffledDevCards = shuffle([...DEV_CARDS]);

  // Create players with starting resources
  const players: Player[] = [0, 1, 2, 3].map(i => ({
    id: i,
    name: playerConfigs?.[i]?.name ?? PLAYER_NAMES[i],
    color: PLAYER_COLORS[i],
    resources: {
      wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0
    },
    pieces: {
      roads: 15,
      settlements: 5,
      cities: 4,
      ships: 15,
    },
    devCards: [],
    victoryPoints: 0,
    knightsPlayed: 0,
    longestRoad: 0,
    isHuman: playerConfigs ? (playerConfigs[i]?.isHuman ?? false) : (i === 0),
  }));

  return {
    players,
    board: { hexes, vertices, edges, ports },
    currentPlayer: 0,
    phase: 'setup1',
    dice: null,
    turn: 1,
    devCardDeck: shuffledDevCards,
    longestRoadHolder: null,
    largestArmyHolder: null,
    winner: null,
    log: [],
    setupRound: 1,
    playersFinishedSetup: [],
    setupStep: 'settlement',
    setupLastSettlementVertexId: null,
    playersToDiscard: [],
    selectedHexForRobber: null,
    stealFromPlayer: null,
  };
}

// Roll dice
export function rollDice(): [number, number] {
  return [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1];
}

// Get total resources for a player
export function getTotalResources(player: Player): number {
  return Object.values(player.resources).reduce((sum, val) => sum + (val || 0), 0);
}

// Distribute resources based on dice roll
export function distributeResources(state: GameState, diceSum: number): void {
  if (diceSum === 7) return; // Robber blocks

  // Log when the robber is blocking a productive hex
  state.board.hexes.forEach(hex => {
    if (hex.number === diceSum && hex.hasRobber && hex.resource !== 'desert') {
      addLog(state, `☠️ Robber blocked ${hex.resource} (${diceSum})`);
    }
  });

  state.board.hexes.forEach(hex => {
    if (hex.number === diceSum && !hex.hasRobber) {
      // Get all vertices on this hex by pixel distance from center
      const { cx, cy } = hexCenterPx(hex.q, hex.r);
      const hexVertices = state.board.vertices.filter(v => {
        const dx = v.x - cx, dy = v.y - cy;
        return Math.sqrt(dx * dx + dy * dy) <= HEX_SIZE + 2;
      });
      
      hexVertices.forEach(vertex => {
        Object.entries(vertex.settlements).forEach(([playerId, type]) => {
          if (type) {
            const player = state.players[parseInt(playerId)];
            const amount = type === 'settlement' ? 1 : 2;
            
            if (hex.resource !== 'desert' && hex.resource !== 'gold') {
              player.resources[hex.resource] = (player.resources[hex.resource] || 0) + amount;
            }
          }
        });
      });
    }
  });
}

// Distribute resources during setup (only for second settlement)
export function distributeSetupResources(state: GameState, playerId: number, vertexId: string): void {
  const vertex = state.board.vertices.find(v => v.id === vertexId);
  if (!vertex) return;
  
  // Find adjacent hexes by pixel distance (vertex is at HEX_SIZE from hex center)
  const adjacentHexes = state.board.hexes.filter(hex => {
    if (hex.resource === 'desert') return false;
    const { cx, cy } = hexCenterPx(hex.q, hex.r);
    const dx = vertex.x - cx, dy = vertex.y - cy;
    return Math.sqrt(dx * dx + dy * dy) <= HEX_SIZE + 2;
  });
  
  const player = state.players[playerId];
  adjacentHexes.forEach(hex => {
    if (hex.resource !== 'gold') {
      player.resources[hex.resource] = (player.resources[hex.resource] || 0) + 1;
    }
  });
}

// Check if a vertex is valid for settlement placement
export function isValidSettlementPlacement(state: GameState, vertexId: string, _playerId: number): boolean {
  const vertex = state.board.vertices.find(v => v.id === vertexId);
  if (!vertex) return false;
  
  // Check if vertex is already occupied by any player
  if (Object.values(vertex.settlements).some(Boolean)) return false;
  
  // Check distance rule - can't be adjacent to another settlement
  const neighbors = getAdjacentVertices(state, vertex);
  for (const neighbor of neighbors) {
    for (const pid in neighbor.settlements) {
      if (neighbor.settlements[pid]) return false;
    }
  }
  
  return true;
}

// Get adjacent vertices
function getAdjacentVertices(state: GameState, vertex: Vertex): Vertex[] {
  // Find vertices that share an edge with this vertex
  return state.board.vertices.filter(v => {
    if (v.id === vertex.id) return false;
    // Same hex - adjacent locations
    if (v.q === vertex.q && v.r === vertex.r) {
      const diff = Math.abs(v.location - vertex.location);
      return diff === 1 || diff === 5;
    }
    // Check neighboring hex vertices
    const dq = Math.abs(v.q - vertex.q);
    const dr = Math.abs(v.r - vertex.r);
    return dq < 1 && dr < 1;
  });
}

// Check if edge is valid for road placement (must connect to own piece)
export function isValidRoadPlacement(state: GameState, edgeId: string, playerId: number): boolean {
  const edge = state.board.edges.find(e => e.id === edgeId);
  if (!edge) return false;
  
  // Check if edge is already occupied by any player
  if (Object.values(edge.roads).some(Boolean)) return false;
  
  // Must be connected to own road or settlement
  const connected = isEdgeConnectedToPlayer(state, edge, playerId);
  return connected;
}

// Check if edge is connected to player's road or settlement
function isEdgeConnectedToPlayer(state: GameState, edge: Edge, playerId: number): boolean {
  // Get the two vertices for this edge
  const hex = state.board.hexes.find(h => h.q === edge.q && h.r === edge.r);
  if (!hex) return false;
  
  const loc1 = edge.location;
  const loc2 = (edge.location + 1) % 6;
  
  // Find vertices at these locations
  const vertices = state.board.vertices.filter(v => 
    Math.abs(v.q - edge.q) < 1.5 && Math.abs(v.r - edge.r) < 1.5 &&
    (v.location === loc1 || v.location === loc2)
  );
  
  for (const v of vertices) {
    // Check if player has settlement/city here
    if (v.settlements[playerId]) return true;
    
    // Check if player has road on adjacent edges
    const adjacentEdges = state.board.edges.filter(e => {
      if (e.id === edge.id) return false;
      const dq = Math.abs(e.q - edge.q);
      const dr = Math.abs(e.r - edge.r);
      return dq < 1 && dr < 1;
    });
    
    for (const adjEdge of adjacentEdges) {
      if (adjEdge.roads[playerId]) return true;
    }
  }
  
  return false;
}

// Check if player can afford something
export function canAfford(player: Player, cost: Partial<Record<Resource, number>>): boolean {
  return Object.entries(cost).every(([res, amount]) => {
    return (player.resources[res as Resource] || 0) >= amount;
  });
}

// Build costs
export const BUILD_COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, wheat: 1, sheep: 1 },
  city: { wheat: 2, ore: 3 },
  ship: { wood: 1, sheep: 1 },
  devCard: { wheat: 1, sheep: 1, ore: 1 },
};

// Deduct resources
export function deductResources(player: Player, cost: Partial<Record<Resource, number>>): void {
  Object.entries(cost).forEach(([res, amount]) => {
    player.resources[res as Resource] = (player.resources[res as Resource] || 0) - amount;
  });
}

// Buy dev card
export function buyDevCard(state: GameState, playerId: number): string | null {
  const player = state.players[playerId];
  
  if (state.devCardDeck.length === 0) return null;
  if (!canAfford(player, BUILD_COSTS.devCard)) return null;
  
  const card = state.devCardDeck.pop()!;
  player.devCards.push(card);
  deductResources(player, BUILD_COSTS.devCard);
  
  return card;
}

// Calculate victory points
export function calculateVP(player: Player, state: GameState): number {
  let vp = 0;
  
  // Count settlements and cities from vertices
  state.board.vertices.forEach(vertex => {
    const settlement = vertex.settlements[player.id.toString()];
    if (settlement === 'settlement') vp += 1;
    if (settlement === 'city') vp += 2;
  });
  
  // VP from dev cards (only hidden victory point cards don't count yet)
  // Actually, all VP cards count toward victory
  const vpCards = player.devCards.filter(c => c === 'victory').length;
  vp += vpCards;
  
  // Largest Army
  if (state.largestArmyHolder === player.id) vp += 2;
  
  // Longest Road
  if (state.longestRoadHolder === player.id) vp += 2;
  
  return vp;
}

// Check for win
export function checkWinCondition(state: GameState): number | null {
  for (const player of state.players) {
    const vp = calculateVP(player, state);
    if (vp >= 10) return player.id;
  }
  return null;
}

// Calculate longest road for a player.
// Uses a vertex-based DFS tracking which road segments have been traversed.
// This correctly handles forks (3+ roads meeting at a junction): you can only
// enter and exit via two of them — you cannot traverse multiple branches as if
// teleporting between roads that merely share a vertex.
export function calculateLongestRoad(state: GameState, playerId: number): number {
  const playerEdges = state.board.edges.filter(e => e.roads[playerId.toString()]);
  if (playerEdges.length === 0) return 0;

  const eps = 9; // squared-distance tolerance (3 px) for matching endpoints

  // Collect unique junction positions (road endpoints) by pixel proximity
  const junctions: { x: number; y: number }[] = [];
  function junctionIndex(x: number, y: number): number {
    for (let i = 0; i < junctions.length; i++) {
      if ((x - junctions[i].x) ** 2 + (y - junctions[i].y) ** 2 < eps) return i;
    }
    junctions.push({ x, y });
    return junctions.length - 1;
  }

  // Map each road segment to its two junction indices
  const edgeEndpoints: [number, number][] = playerEdges.map(e => [
    junctionIndex(e.x1, e.y1),
    junctionIndex(e.x2, e.y2),
  ]);

  // Build adjacency: junction index → list of [other_junction, edge_index]
  const adj = new Map<number, [number, number][]>();
  edgeEndpoints.forEach(([v1, v2], i) => {
    if (!adj.has(v1)) adj.set(v1, []);
    if (!adj.has(v2)) adj.set(v2, []);
    adj.get(v1)!.push([v2, i]);
    adj.get(v2)!.push([v1, i]);
  });

  // DFS from a junction, tracking which road segments are in use.
  // Vertices may be revisited; road segments may not.
  const usedEdges = new Array(playerEdges.length).fill(false);
  function dfs(junction: number): number {
    let maxLen = 0;
    for (const [neighbor, edgeIdx] of (adj.get(junction) || [])) {
      if (!usedEdges[edgeIdx]) {
        usedEdges[edgeIdx] = true;
        const len = 1 + dfs(neighbor);
        usedEdges[edgeIdx] = false;
        if (len > maxLen) maxLen = len;
      }
    }
    return maxLen;
  }

  let longest = 0;
  for (let v = 0; v < junctions.length; v++) {
    const len = dfs(v);
    if (len > longest) longest = len;
  }
  return longest;
}

// Update longest road holder
export function updateLongestRoad(state: GameState): void {
  // Recalculate road lengths for all players
  state.players.forEach(player => {
    player.longestRoad = calculateLongestRoad(state, player.id);
  });

  const currentHolderRoad = state.longestRoadHolder !== null
    ? state.players[state.longestRoadHolder].longestRoad
    : 0;

  // Find the player with the longest road who has >= 5 and beats the current holder
  let maxRoad = Math.max(currentHolderRoad, 4); // challenger must exceed current holder
  let newHolder: number | null = state.longestRoadHolder;

  state.players.forEach(player => {
    if (player.longestRoad > maxRoad) {
      maxRoad = player.longestRoad;
      newHolder = player.id;
    }
  });

  // If current holder no longer has >= 5 roads and nobody else qualifies, clear the title
  if (newHolder !== null && state.players[newHolder].longestRoad < 5) {
    newHolder = null;
  }

  state.longestRoadHolder = newHolder;
}

// Update largest army holder
export function updateLargestArmy(state: GameState): void {
  const currentHolderKnights = state.largestArmyHolder !== null
    ? state.players[state.largestArmyHolder].knightsPlayed
    : 0;

  // Challenger must strictly exceed the current holder (and meet the minimum of 3)
  let maxKnights = Math.max(currentHolderKnights, 2); // minimum threshold is 3, so seed at 2
  let newHolder: number | null = state.largestArmyHolder;

  state.players.forEach(player => {
    if (player.knightsPlayed > maxKnights) {
      maxKnights = player.knightsPlayed;
      newHolder = player.id;
    }
  });

  // If current holder no longer has >= 3 knights and nobody else qualifies, clear the title
  if (newHolder !== null && state.players[newHolder].knightsPlayed < 3) {
    newHolder = null;
  }

  state.largestArmyHolder = newHolder;
}

// Get players who need to discard (have more than 7 cards)
export function getPlayersToDiscard(state: GameState): number[] {
  return state.players
    .filter(p => getTotalResources(p) > 7)
    .map(p => p.id);
}

// Discard half resources (round down)
export function discardHalf(state: GameState, playerId: number): void {
  const player = state.players[playerId];
  const total = getTotalResources(player);
  const toDiscard = Math.floor(total / 2);
  if (toDiscard === 0) return;

  // Build a flat list of every card the player holds, then shuffle it.
  // Taking the first `toDiscard` entries guarantees exactly the right
  // number is discarded regardless of resource distribution.
  const flat: Resource[] = [];
  for (const r of ['wood', 'brick', 'sheep', 'wheat', 'ore'] as Resource[]) {
    for (let i = 0; i < (player.resources[r] ?? 0); i++) flat.push(r);
  }

  // Fisher-Yates shuffle
  for (let i = flat.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [flat[i], flat[j]] = [flat[j], flat[i]];
  }

  for (let i = 0; i < toDiscard; i++) {
    player.resources[flat[i]] = (player.resources[flat[i]] ?? 0) - 1;
  }
}

// Move robber
export function moveRobber(state: GameState, hexId: string): void {
  const hex = state.board.hexes.find(h => h.id === hexId);
  if (!hex) return;
  
  // Remove robber from old hex
  state.board.hexes.forEach(h => {
    h.hasRobber = false;
  });
  
  // Add robber to new hex
  hex.hasRobber = true;
  state.selectedHexForRobber = hex;
}

// Get players adjacent to hex (for stealing)
export function getPlayersAdjacentToHex(state: GameState, hex: Hex): Player[] {
  const { cx, cy } = hexCenterPx(hex.q, hex.r);
  const adjacentVertices = state.board.vertices.filter(v => {
    const dx = v.x - cx, dy = v.y - cy;
    return Math.sqrt(dx * dx + dy * dy) <= HEX_SIZE + 2;
  });
  
  const playerIds = new Set<number>();
  adjacentVertices.forEach(v => {
    Object.keys(v.settlements).forEach(pid => {
      if (v.settlements[pid]) {
        playerIds.add(parseInt(pid));
      }
    });
  });
  
  return state.players.filter(p => playerIds.has(p.id) && p.id !== state.currentPlayer);
}

// Steal resource from player
export function stealResource(state: GameState, fromPlayerId: number): void {
  const fromPlayer = state.players[fromPlayerId];
  const toPlayer = state.players[state.currentPlayer];
  
  // Find a resource to steal
  const resources = (['wood', 'brick', 'sheep', 'wheat', 'ore'] as Resource[]).filter(
    r => (fromPlayer.resources[r] || 0) > 0
  );
  
  if (resources.length > 0) {
    const res = resources[Math.floor(Math.random() * resources.length)];
    fromPlayer.resources[res] = (fromPlayer.resources[res] || 0) - 1;
    toPlayer.resources[res] = (toPlayer.resources[res] || 0) + 1;
  }
}

// Bank trade
export function bankTrade(state: GameState, playerId: number, give: Resource, get: Resource, ratio: number): boolean {
  const player = state.players[playerId];
  
  if (!canAfford(player, { [give]: ratio })) return false;
  
  player.resources[give] = (player.resources[give] || 0) - ratio;
  player.resources[get] = (player.resources[get] || 0) + 1;
  
  return true;
}

// Play knight
export function playKnight(state: GameState, playerId: number): void {
  const player = state.players[playerId];
  const knightIndex = player.devCards.indexOf('knight');
  
  if (knightIndex === -1) return;
  
  player.devCards.splice(knightIndex, 1);
  player.knightsPlayed++;
  updateLargestArmy(state);
}

// Play road building
export function playRoadBuilding(state: GameState, playerId: number): void {
  const player = state.players[playerId];
  const index = player.devCards.indexOf('road');
  
  if (index === -1) return;
  
  player.devCards.splice(index, 1);
  // The actual road placement is handled in UI
}

// Play year of plenty
export function playYearOfPlenty(state: GameState, playerId: number, resource1: Resource, resource2: Resource): void {
  const player = state.players[playerId];
  const index = player.devCards.indexOf('plenty');
  
  if (index === -1) return;
  
  player.devCards.splice(index, 1);
  player.resources[resource1] = (player.resources[resource1] || 0) + 1;
  player.resources[resource2] = (player.resources[resource2] || 0) + 1;
}

// Play monopoly
export function playMonopoly(state: GameState, playerId: number, resource: Resource): void {
  const player = state.players[playerId];
  const index = player.devCards.indexOf('monopoly');
  
  if (index === -1) return;
  
  player.devCards.splice(index, 1);
  
  let total = 0;
  state.players.forEach(p => {
    if (p.id !== playerId) {
      const amount = p.resources[resource] || 0;
      p.resources[resource] = 0;
      total += amount;
    }
  });
  
  player.resources[resource] = (player.resources[resource] || 0) + total;
}

// Add log entry
export function addLog(state: GameState, action: string): void {
  state.log.push({
    turn: state.turn,
    player: state.currentPlayer,
    action,
    timestamp: Date.now(),
  });
}

// Advance snake-draft setup to next player / phase.
// Call this after a player finishes placing their road during setup.
export function advanceSetupState(state: GameState): void {
  if (state.phase === 'setup1') {
    if (state.currentPlayer < 3) {
      // Next player clockwise
      state.currentPlayer++;
    } else {
      // Player 3 finished setup1 → setup2 starts, player 3 goes first (same player)
      state.phase = 'setup2';
      // currentPlayer stays at 3
    }
  } else if (state.phase === 'setup2') {
    if (state.currentPlayer > 0) {
      // Next player counter-clockwise
      state.currentPlayer--;
    } else {
      // Player 0 finished setup2 → game begins
      state.phase = 'playing';
      state.currentPlayer = 0;
      state.turn = 1;
    }
  }
  state.setupStep = 'settlement';
  state.setupLastSettlementVertexId = null;
}

// Setup phase helpers
export function getNextSetupPlayer(state: GameState): number {
  const currentIdx = state.playersFinishedSetup.length;
  
  if (state.phase === 'setup1') {
    // Clockwise order: 0, 1, 2, 3
    return currentIdx;
  } else if (state.phase === 'setup2') {
    // Reverse order: 3, 2, 1, 0
    return 3 - currentIdx;
  }
  
  return state.currentPlayer;
}

export function completeSetup(state: GameState): void {
  state.playersFinishedSetup.push(state.currentPlayer);
  
  if (state.phase === 'setup1') {
    if (state.playersFinishedSetup.length >= 4) {
      // Move to setup2
      state.phase = 'setup2';
      state.playersFinishedSetup = [];
      state.currentPlayer = 3; // Start with player 3 in reverse
    } else {
      state.currentPlayer = getNextSetupPlayer(state);
    }
  } else if (state.phase === 'setup2') {
    if (state.playersFinishedSetup.length >= 4) {
      // Start the game
      state.phase = 'playing';
      state.currentPlayer = 0;
      state.turn = 1;
    } else {
      state.currentPlayer = getNextSetupPlayer(state);
    }
  }
}

// Get valid settlement positions for current player
export function getValidSettlements(state: GameState): Vertex[] {
  return state.board.vertices.filter(v => isValidSettlementPlacement(state, v.id, state.currentPlayer));
}

// Get valid road positions for current player
export function getValidRoads(state: GameState): Edge[] {
  return state.board.edges.filter(e => isValidRoadPlacement(state, e.id, state.currentPlayer));
}

// Check if vertex has adjacent road for setup (during setup, can place road anywhere)
export function canPlaceRoadInSetup(state: GameState, edgeId: string, playerId: number): boolean {
  // During setup, roads must connect to settlement just placed OR to another road
  // For simplicity, we allow any edge connected to the settlement
  
  const edge = state.board.edges.find(e => e.id === edgeId);
  if (!edge || edge.roads[playerId.toString()]) return false;
  
  // Check if connected to player's most recent settlement
  const playerVertices = state.board.vertices.filter(v => v.settlements[playerId.toString()]);
  
  for (const v of playerVertices) {
    // Check if edge is adjacent to this vertex
    const hex = state.board.hexes.find(h => h.q === edge.q && h.r === edge.r);
    if (!hex) continue;
    
    const loc1 = edge.location;
    const loc2 = (edge.location + 1) % 6;
    
    if (v.location === loc1 || v.location === loc2) {
      return true;
    }
  }
  
  // Also check for adjacent roads (for the second road during setup)
  const adjacentEdges = state.board.edges.filter(e => {
    if (e.id === edge.id) return false;
    const dq = Math.abs(e.q - edge.q);
    const dr = Math.abs(e.r - edge.r);
    return dq < 1 && dr < 1;
  });
  
  for (const adj of adjacentEdges) {
    if (adj.roads[playerId.toString()]) return true;
  }
  
  return playerVertices.length === 0; // Can place first road anywhere if no settlements yet
}
