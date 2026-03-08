import { useState, useEffect } from 'react';
import type { GameState, Hex, Resource, Vertex, Edge, Port, Player } from './types';
import {
  createInitialGameState, rollDice, distributeResources,
  calculateVP, addLog, advanceSetupState, canAfford, BUILD_COSTS,
  getTotalResources, discardHalf,
  updateLargestArmy, updateLongestRoad,
  playKnight, playRoadBuilding, playYearOfPlenty, playMonopoly,
} from './gameState';
import { aiBestSetupSettlement, aiBestSetupRoad, aiDoFullTurn } from './ai';
import { HEX_SIZE, hexCenterPx } from './board';
import './App.css';

// ── Geometry helpers ──────────────────────────────────────────────────────────

function distSq(ax: number, ay: number, bx: number, by: number) {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

function edgesShareEndpoint(e1: Edge, e2: Edge): boolean {
  const eps = 9;
  return (
    distSq(e1.x1, e1.y1, e2.x1, e2.y1) < eps ||
    distSq(e1.x1, e1.y1, e2.x2, e2.y2) < eps ||
    distSq(e1.x2, e1.y2, e2.x1, e2.y1) < eps ||
    distSq(e1.x2, e1.y2, e2.x2, e2.y2) < eps
  );
}

// ── Port geometry ─────────────────────────────────────────────────────────────

/** Pixel coords for a port: two access vertices + the dock position outside the board. */
function portPixels(port: Port) {
  const { q, r, edge } = port.location;
  const { cx, cy } = hexCenterPx(q, r);
  const a1 = (edge * Math.PI) / 3;
  const a2 = ((edge + 1) % 6 * Math.PI) / 3;
  const x1 = cx + HEX_SIZE * Math.cos(a1);
  const y1 = cy + HEX_SIZE * Math.sin(a1);
  const x2 = cx + HEX_SIZE * Math.cos(a2);
  const y2 = cy + HEX_SIZE * Math.sin(a2);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // Outward direction from hex centre through edge midpoint
  const dx = mx - cx; const dy = my - cy;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ox = mx + (dx / len) * 32;
  const oy = my + (dy / len) * 32;
  return { x1, y1, x2, y2, ox, oy };
}

/** Best trade ratio for each resource given the player's port access. */
function getTradeRatios(game: GameState, playerId: number): Record<string, number> {
  const ratios: Record<string, number> = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };

  game.board.ports.forEach(port => {
    const { x1, y1, x2, y2 } = portPixels(port);
    const hasAccess = game.board.vertices.some(v => {
      if (!v.settlements[playerId.toString()]) return false;
      return distSq(v.x, v.y, x1, y1) < 9 || distSq(v.x, v.y, x2, y2) < 9;
    });
    if (!hasAccess) return;
    if (port.resource === 'generic') {
      Object.keys(ratios).forEach(r => { if (ratios[r] > port.ratio) ratios[r] = port.ratio; });
    } else {
      if (ratios[port.resource] > port.ratio) ratios[port.resource] = port.ratio;
    }
  });
  return ratios;
}

// ── Valid placement helpers ───────────────────────────────────────────────────

function getValidSettlementVertices(game: GameState): Vertex[] {
  const playerId = game.currentPlayer.toString();
  return game.board.vertices.filter(v => {
    if (Object.values(v.settlements).some(s => s)) return false;
    for (const other of game.board.vertices) {
      if (!Object.values(other.settlements).some(s => s)) continue;
      if (distSq(v.x, v.y, other.x, other.y) < (HEX_SIZE * 1.1) ** 2) return false;
    }
    if (game.phase === 'playing') {
      const hasRoad = game.board.edges.some(e => {
        if (!e.roads[playerId]) return false;
        return distSq(v.x, v.y, e.x1, e.y1) < 9 || distSq(v.x, v.y, e.x2, e.y2) < 9;
      });
      if (!hasRoad) return false;
    }
    return true;
  });
}

function getValidRoadEdgesSetup(game: GameState): Edge[] {
  const lastId = game.setupLastSettlementVertexId;
  if (!lastId) return [];
  const vertex = game.board.vertices.find(v => v.id === lastId);
  if (!vertex) return [];
  return game.board.edges.filter(e => {
    if (Object.values(e.roads).some(r => r)) return false;
    return distSq(vertex.x, vertex.y, e.x1, e.y1) < 9 ||
           distSq(vertex.x, vertex.y, e.x2, e.y2) < 9;
  });
}

function getValidRoadEdges(game: GameState): Edge[] {
  const playerId = game.currentPlayer.toString();
  return game.board.edges.filter(e => {
    if (Object.values(e.roads).some(r => r)) return false;
    const endpoints = game.board.vertices.filter(
      v => distSq(v.x, v.y, e.x1, e.y1) < 9 || distSq(v.x, v.y, e.x2, e.y2) < 9
    );
    for (const v of endpoints) { if (v.settlements[playerId]) return true; }
    for (const other of game.board.edges) {
      if (!other.roads[playerId]) continue;
      if (edgesShareEndpoint(e, other)) return true;
    }
    return false;
  });
}

function getAdjacentResources(game: GameState, vertexId: string): Resource[] {
  const vertex = game.board.vertices.find(v => v.id === vertexId);
  if (!vertex) return [];
  return game.board.hexes
    .filter(hex => {
      if (hex.resource === 'desert') return false;
      const { cx, cy } = hexCenterPx(hex.q, hex.r);
      return Math.sqrt(distSq(vertex.x, vertex.y, cx, cy)) <= HEX_SIZE + 2;
    })
    .map(hex => hex.resource as Resource);
}

// ── Display config ────────────────────────────────────────────────────────────

const RESOURCES: Resource[] = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

// Icons used in UI (player cards, build buttons, trade, log)
const HEX_ICON: Record<Resource, string> = {
  wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰️', desert: '🏜️', gold: '💰',
};

// Large illustrated emoji shown on each hex tile — no text labels, just visual art
const HEX_TILE_EMOJI: Record<Resource, string[]> = {
  wood:   ['🌲', '🌲', '🌲'],  // three trees
  brick:  ['🧱'],              // brick
  sheep:  ['🐑', '🐑'],        // sheep
  wheat:  ['🌾', '🌾'],        // wheat sheaves
  ore:    ['⛰️', '⛰️'],        // mountains + stone
  desert: ['🏜️'],              // desert
  gold:   ['💰'],
};

const HEX_COLOR: Record<Resource, string> = {
  wood:   '#1e4d1a',  // deep forest green
  brick:  '#7a3010',  // terracotta/clay
  sheep:  '#6db84a',  // pasture green
  wheat:  '#c8961e',  // golden fields
  ore:    '#5a6470',  // slate gray
  desert: '#c8aa6e',  // sandy tan
  gold:   '#d4a017',
};

// Number of probability dots for each dice number (2-dice combinations out of 36)
// 2→1, 3→2, 4→3, 5→4, 6→5, 8→5, 9→4, 10→3, 11→2, 12→1
const PROBABILITY_DOTS: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
};

const PORT_ICON: Record<string, string> = {
  wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰️', generic: '⚓',
};

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [game, setGame] = useState<GameState>(createInitialGameState());
  const [buildingMode, setBuildingMode] = useState<'road' | 'settlement' | 'city' | null>(null);
  const [tradeOffer, setTradeOffer] = useState<Partial<Record<Resource, number>>>({});
  const [tradeRequest, setTradeRequest] = useState<Partial<Record<Resource, number>>>({});
  const [buildError, setBuildError] = useState<string | null>(null);
  const [devCardMode, setDevCardMode] = useState<'knight' | 'road' | 'plenty' | 'monopoly' | null>(null);
  const [roadBuildingRoadsLeft, setRoadBuildingRoadsLeft] = useState(0);
  const [yearOfPlentyPicks, setYearOfPlentyPicks] = useState<Resource[]>([]);
  const [devCardPlayedThisTurn, setDevCardPlayedThisTurn] = useState(false);
  const [showPlayerTrade, setShowPlayerTrade] = useState(false);
  const [playerTradeOffer, setPlayerTradeOffer] = useState<Partial<Record<Resource, number>>>({});
  const [playerTradeRequest, setPlayerTradeRequest] = useState<Partial<Record<Resource, number>>>({});
  const [playerTradeResponses, setPlayerTradeResponses] = useState<{ playerId: number; accepts: boolean }[]>([]);

  const currentPlayer = game.players[game.currentPlayer];
  const isSetup = game.phase === 'setup1' || game.phase === 'setup2';
  const isHumanTurn = currentPlayer?.isHuman;

  // Affordability checks (only relevant during playing phase)
  const canBuildRoad = canAfford(currentPlayer, BUILD_COSTS.road);
  const canBuildSettlement = canAfford(currentPlayer, BUILD_COSTS.settlement);
  const canBuildCity = canAfford(currentPlayer, BUILD_COSTS.city);
  const canBuildDevCard = canAfford(currentPlayer, BUILD_COSTS.devCard) && game.devCardDeck.length > 0;

  const tradeRatios = isHumanTurn ? getTradeRatios(game, game.currentPlayer) : {};
  const totalOfferCredits = RESOURCES.reduce((s, r) => s + Math.floor((tradeOffer[r] || 0) / (tradeRatios[r] || 4)), 0);
  const totalRequestAmount = (Object.keys(tradeRequest) as Resource[]).reduce((s, r) => s + (tradeRequest[r] || 0), 0);

  // Robber state: human moves robber after rolling 7
  const [robbingMode, setRobbingMode] = useState(false);
  const [stealCandidates, setStealCandidates] = useState<Player[]>([]);

  // True while the human must move the robber or choose who to steal from
  const mustMoveRobber = robbingMode || stealCandidates.length > 0;

  // Clear build error after 3 seconds
  useEffect(() => {
    if (!buildError) return;
    const t = setTimeout(() => setBuildError(null), 3000);
    return () => clearTimeout(t);
  }, [buildError]);

  // Reset turn-local state when a new human turn begins (after AI turns)
  useEffect(() => {
    if (game.players[game.currentPlayer]?.isHuman && game.phase === 'playing') {
      setDevCardPlayedThisTurn(false);
      setDevCardMode(null);
      setRoadBuildingRoadsLeft(0);
      setYearOfPlentyPicks([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.currentPlayer]);

  // ── AI auto-placement during setup (smart: score by probability) ────────────
  useEffect(() => {
    if (!isSetup || isHumanTurn) return;
    const timeout = setTimeout(() => {
      if (game.setupStep === 'settlement') {
        const vertexId = aiBestSetupSettlement(game);
        if (vertexId) doPlaceSettlement(game, vertexId);
      } else {
        const edgeId = aiBestSetupRoad(game);
        if (edgeId) doPlaceRoad(game, edgeId);
      }
    }, 700);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.currentPlayer, game.phase, game.setupStep]);

  // ── AI playing turn ──────────────────────────────────────────────────────────
  useEffect(() => {
    const aiPlayerId = game.currentPlayer;
    if (game.phase !== 'playing' || game.players[aiPlayerId]?.isHuman) return;

    const timer = setTimeout(() => {
      setGame(prev => {
        // Bail if the turn already moved on (e.g. another update raced in)
        if (prev.currentPlayer !== aiPlayerId || prev.players[aiPlayerId].isHuman) return prev;

        // Roll dice
        const dice = rollDice();
        const sum = dice[0] + dice[1];
        const afterRoll: GameState = { ...prev, dice };
        if (sum !== 7) {
          distributeResources(afterRoll, sum);
        } else {
          for (const p of afterRoll.players) {
            if (getTotalResources(p) >= 8) discardHalf(afterRoll, p.id);
          }
        }
        addLog(afterRoll, `${prev.players[aiPlayerId].name} rolled ${dice[0]}+${dice[1]}=${sum}`);

        // Build decisions + advance turn
        return aiDoFullTurn(afterRoll);
      });
    }, 900);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.currentPlayer, game.phase]);

  // ── Core placement ────────────────────────────────────────────────────────

  function doPlaceSettlement(prev: GameState, vertexId: string) {
    const player = prev.players[prev.currentPlayer];
    setGame(state => {
      const newGame: GameState = {
        ...state,
        board: {
          ...state.board,
          vertices: state.board.vertices.map(v =>
            v.id !== vertexId ? v
              : { ...v, settlements: { ...v.settlements, [player.id]: 'settlement' as const } }
          ),
        },
        players: state.players.map(p =>
          p.id !== player.id ? p : { ...p, pieces: { ...p.pieces, settlements: p.pieces.settlements - 1 } }
        ),
        setupStep: 'road',
        setupLastSettlementVertexId: vertexId,
      };
      if (state.phase === 'setup2') {
        const resources = getAdjacentResources(state, vertexId);
        const resMap = { ...newGame.players[player.id].resources };
        for (const r of resources) resMap[r] = (resMap[r] || 0) + 1;
        newGame.players = newGame.players.map(p =>
          p.id !== player.id ? p : { ...p, resources: resMap }
        );
        addLog(newGame, `${player.name} placed settlement → got: ${resources.map(r => HEX_ICON[r]).join(' ') || 'nothing'}`);
      } else {
        addLog(newGame, `${player.name} placed a settlement`);
      }
      return newGame;
    });
    setBuildingMode(null);
  }

  function doPlaceRoad(prev: GameState, edgeId: string) {
    const player = prev.players[prev.currentPlayer];
    setGame(state => {
      const newGame: GameState = {
        ...state,
        board: {
          ...state.board,
          edges: state.board.edges.map(e =>
            e.id !== edgeId ? e : { ...e, roads: { ...e.roads, [player.id]: 'road' as const } }
          ),
        },
        players: state.players.map(p =>
          p.id !== player.id ? p : { ...p, pieces: { ...p.pieces, roads: p.pieces.roads - 1 } }
        ),
      };
      if (state.phase === 'setup1' || state.phase === 'setup2') {
        advanceSetupState(newGame);
      } else {
        newGame.players = newGame.players.map(p =>
          p.id !== player.id ? p : {
            ...p,
            resources: { ...p.resources, wood: (p.resources.wood || 0) - 1, brick: (p.resources.brick || 0) - 1 },
          }
        );
        updateLongestRoad(newGame);
      }
      addLog(newGame, `${player.name} placed a road`);
      return newGame;
    });
    setBuildingMode(null);
  }

  // ── Human action handlers ────────────────────────────────────────────────────

  const handlePlaceSettlement = (vertexId: string) => doPlaceSettlement(game, vertexId);
  const handlePlaceRoad       = (edgeId: string)   => doPlaceRoad(game, edgeId);

  const handlePlaceSettlementPlaying = (vertexId: string) => {
    if (!canBuildSettlement) { setBuildError('Not enough resources! Need 1🌲 1🧱 1🌾 1🐑'); return; }
    const player = currentPlayer;
    setGame(prev => {
      const newGame: GameState = {
        ...prev,
        board: {
          ...prev.board,
          vertices: prev.board.vertices.map(v =>
            v.id !== vertexId ? v
              : { ...v, settlements: { ...v.settlements, [player.id]: 'settlement' as const } }
          ),
        },
        players: prev.players.map(p =>
          p.id !== player.id ? p : {
            ...p,
            resources: {
              ...p.resources,
              wood: (p.resources.wood || 0) - 1, brick: (p.resources.brick || 0) - 1,
              wheat: (p.resources.wheat || 0) - 1, sheep: (p.resources.sheep || 0) - 1,
            },
            pieces: { ...p.pieces, settlements: p.pieces.settlements - 1 },
          }
        ),
      };
      addLog(newGame, `${player.name} built a settlement`);
      return newGame;
    });
    setBuildingMode(null);
  };

  const handlePlaceRoadPlaying = (edgeId: string) => {
    if (roadBuildingRoadsLeft > 0) {
      // Free road from Road Building dev card
      const player = game.players[game.currentPlayer];
      setGame(prev => {
        const newGame: GameState = {
          ...prev,
          board: {
            ...prev.board,
            edges: prev.board.edges.map(e =>
              e.id !== edgeId ? e : { ...e, roads: { ...e.roads, [player.id]: 'road' as const } }
            ),
          },
          players: prev.players.map(p =>
            p.id !== player.id ? p : { ...p, pieces: { ...p.pieces, roads: p.pieces.roads - 1 } }
          ),
        };
        updateLongestRoad(newGame);
        addLog(newGame, `${player.name} placed a free road`);
        return newGame;
      });
      setRoadBuildingRoadsLeft(prev => {
        const next = prev - 1;
        if (next === 0) setBuildingMode(null);
        return next;
      });
      return;
    }
    if (!canBuildRoad) { setBuildError('Not enough resources! Need 1🌲 1🧱'); return; }
    doPlaceRoad(game, edgeId);
  };

  const handleRollDice = () => {
    const dice = rollDice();
    const sum = dice[0] + dice[1];
    setGame(prev => {
      const newGame = { ...prev, dice };
      if (sum !== 7) {
        distributeResources(newGame, sum);
      } else {
        // Auto-discard half for anyone (human included) with 8+ cards
        for (const p of newGame.players) {
          if (getTotalResources(p) >= 8) discardHalf(newGame, p.id);
        }
      }
      addLog(newGame, `Rolled ${dice[0]} + ${dice[1]} = ${sum}`);
      return newGame;
    });
    if (sum === 7) {
      setBuildingMode(null);
      setTradeOffer({}); setTradeRequest({});
      setRobbingMode(true);
    }
  };

  const handleEndTurn = () => {
    setBuildingMode(null);
    setTradeOffer({}); setTradeRequest({});
    setDevCardMode(null);
    setRoadBuildingRoadsLeft(0);
    setYearOfPlentyPicks([]);
    setDevCardPlayedThisTurn(false);
    setShowPlayerTrade(false);
    setPlayerTradeOffer({}); setPlayerTradeRequest({}); setPlayerTradeResponses([]);
    setGame(prev => ({
      ...prev,
      currentPlayer: (prev.currentPlayer + 1) % 4,
      turn: prev.turn + 1,
      dice: null,
    }));
  };

  const handleNewGame = () => {
    setBuildingMode(null); setTradeOffer({}); setTradeRequest({}); setBuildError(null);
    setDevCardMode(null); setRoadBuildingRoadsLeft(0); setYearOfPlentyPicks([]);
    setDevCardPlayedThisTurn(false);
    setShowPlayerTrade(false); setPlayerTradeOffer({}); setPlayerTradeRequest({}); setPlayerTradeResponses([]);
    setGame(createInitialGameState());
  };

  const handleBuildToggle = (type: 'road' | 'settlement' | 'city') => {
    if (type === 'road' && !canBuildRoad) { setBuildError('Not enough resources! Need 1🌲 1🧱'); return; }
    if (type === 'settlement' && !canBuildSettlement) { setBuildError('Not enough resources! Need 1🌲 1🧱 1🌾 1🐑'); return; }
    if (type === 'city' && !canBuildCity) { setBuildError('Not enough resources! Need 2🌾 3⛏️'); return; }
    setBuildingMode(prev => prev === type ? null : type);
    setBuildError(null);
  };

  const handleBankTrade = () => {
    if (totalOfferCredits === 0 || totalRequestAmount === 0 || totalRequestAmount > totalOfferCredits) return;
    const player = currentPlayer;
    setGame(prev => {
      const newResources = { ...prev.players[prev.currentPlayer].resources };
      RESOURCES.forEach(r => {
        const ratio = tradeRatios[r] || 4;
        const offered = tradeOffer[r] || 0;
        const usedBatches = Math.floor(offered / ratio);
        newResources[r] = (newResources[r] || 0) - usedBatches * ratio;
      });
      RESOURCES.forEach(r => {
        newResources[r] = (newResources[r] || 0) + (tradeRequest[r] || 0);
      });
      const newGame = {
        ...prev,
        players: prev.players.map(p => p.id !== player.id ? p : { ...p, resources: newResources }),
      };
      const giveStr = RESOURCES.filter(r => tradeOffer[r]).map(r => `${tradeOffer[r]}${HEX_ICON[r]}`).join(' ');
      const getStr = RESOURCES.filter(r => tradeRequest[r]).map(r => `${tradeRequest[r]}${HEX_ICON[r]}`).join(' ');
      addLog(newGame, `${player.name} traded ${giveStr} → ${getStr}`);
      return newGame;
    });
    setTradeOffer({}); setTradeRequest({});
  };

  const handleProposePlayerTrade = () => {
    const totalOff = RESOURCES.reduce((s, r) => s + (playerTradeOffer[r] || 0), 0);
    const totalReq = RESOURCES.reduce((s, r) => s + (playerTradeRequest[r] || 0), 0);
    if (totalOff === 0 || totalReq === 0) return;
    const responses = game.players
      .filter(p => !p.isHuman)
      .map(p => {
        const hasAll = RESOURCES.every(r => (p.resources[r] || 0) >= (playerTradeRequest[r] || 0));
        // AI declines if they'd give away too much relative to what they get
        const accepts = hasAll && totalOff > 0;
        return { playerId: p.id, accepts };
      });
    setPlayerTradeResponses(responses);
  };

  const handleExecutePlayerTrade = (fromPlayerId: number) => {
    const player = currentPlayer;
    setGame(prev => {
      const newPlayers = prev.players.map(p => {
        if (p.id === player.id) {
          const r = { ...p.resources };
          RESOURCES.forEach(res => {
            r[res] = (r[res] || 0) - (playerTradeOffer[res] || 0) + (playerTradeRequest[res] || 0);
          });
          return { ...p, resources: r };
        }
        if (p.id === fromPlayerId) {
          const r = { ...p.resources };
          RESOURCES.forEach(res => {
            r[res] = (r[res] || 0) + (playerTradeOffer[res] || 0) - (playerTradeRequest[res] || 0);
          });
          return { ...p, resources: r };
        }
        return p;
      });
      const newGame = { ...prev, players: newPlayers };
      const offerStr = RESOURCES.filter(r => (playerTradeOffer[r] || 0) > 0).map(r => `${playerTradeOffer[r]}${HEX_ICON[r]}`).join('+');
      const reqStr = RESOURCES.filter(r => (playerTradeRequest[r] || 0) > 0).map(r => `${playerTradeRequest[r]}${HEX_ICON[r]}`).join('+');
      addLog(newGame, `${player.name} traded ${offerStr} with ${prev.players[fromPlayerId].name} for ${reqStr}`);
      return newGame;
    });
    setShowPlayerTrade(false); setPlayerTradeOffer({}); setPlayerTradeRequest({}); setPlayerTradeResponses([]);
  };

  const handleBuyDevCard = () => {
    if (!canBuildDevCard) { setBuildError('Need 1🌾 1🐑 1⛏️ to buy a dev card'); return; }
    setGame(prev => {
      if (prev.devCardDeck.length === 0) return prev;
      const buyer = prev.players[prev.currentPlayer];
      if (!canAfford(buyer, BUILD_COSTS.devCard)) return prev;
      const newDeck = [...prev.devCardDeck];
      const card = newDeck.pop()!;
      const newGame = {
        ...prev,
        devCardDeck: newDeck,
        players: prev.players.map(p =>
          p.id !== prev.currentPlayer ? p
            : {
                ...p,
                devCards: [...p.devCards, card],
                resources: {
                  ...p.resources,
                  wheat: (p.resources.wheat || 0) - 1,
                  sheep: (p.resources.sheep || 0) - 1,
                  ore: (p.resources.ore || 0) - 1,
                },
              }
        ),
      };
      addLog(newGame, `${buyer.name} bought a development card`);
      return newGame;
    });
  };

  const handlePlayKnight = () => {
    setGame(prev => {
      const newGame = {
        ...prev,
        players: prev.players.map(p =>
          p.id !== prev.currentPlayer ? p : { ...p, devCards: [...p.devCards] }
        ),
      };
      playKnight(newGame, prev.currentPlayer);
      updateLargestArmy(newGame);
      addLog(newGame, `${prev.players[prev.currentPlayer].name} played a Knight`);
      return newGame;
    });
    setDevCardPlayedThisTurn(true);
    setDevCardMode(null);
    setRobbingMode(true);
  };

  const handlePlayRoadBuilding = () => {
    setGame(prev => {
      const newGame = {
        ...prev,
        players: prev.players.map(p =>
          p.id !== prev.currentPlayer ? p : { ...p, devCards: [...p.devCards] }
        ),
      };
      playRoadBuilding(newGame, prev.currentPlayer);
      addLog(newGame, `${prev.players[prev.currentPlayer].name} played Road Building`);
      return newGame;
    });
    setDevCardPlayedThisTurn(true);
    setDevCardMode(null);
    setRoadBuildingRoadsLeft(2);
    setBuildingMode('road');
  };

  const handlePickYearOfPlentyResource = (r: Resource) => {
    const newPicks = [...yearOfPlentyPicks, r];
    setYearOfPlentyPicks(newPicks);
    if (newPicks.length === 2) {
      setGame(prev => {
        const newGame = {
          ...prev,
          players: prev.players.map(p =>
            p.id !== prev.currentPlayer ? p : { ...p, devCards: [...p.devCards], resources: { ...p.resources } }
          ),
        };
        playYearOfPlenty(newGame, prev.currentPlayer, newPicks[0], newPicks[1]);
        addLog(newGame, `${prev.players[prev.currentPlayer].name} played Year of Plenty → ${HEX_ICON[newPicks[0]]} ${HEX_ICON[newPicks[1]]}`);
        return newGame;
      });
      setDevCardMode(null);
      setYearOfPlentyPicks([]);
      setDevCardPlayedThisTurn(true);
    }
  };

  const handlePlayMonopoly = (r: Resource) => {
    setGame(prev => {
      const newGame = {
        ...prev,
        players: prev.players.map(p => ({ ...p, devCards: [...p.devCards], resources: { ...p.resources } })),
      };
      playMonopoly(newGame, prev.currentPlayer, r);
      addLog(newGame, `${prev.players[prev.currentPlayer].name} played Monopoly on ${r}!`);
      return newGame;
    });
    setDevCardMode(null);
    setDevCardPlayedThisTurn(true);
  };

  const handleMoveRobber = (hexId: string) => {
    setRobbingMode(false);
    const hex = game.board.hexes.find(h => h.id === hexId)!;
    const { cx, cy } = hexCenterPx(hex.q, hex.r);
    // Find adjacent opponents who have resources to steal
    const adjacent = game.players.filter(p => {
      if (p.id === game.currentPlayer) return false;
      if (getTotalResources(p) === 0) return false;
      return game.board.vertices.some(v => {
        if (!v.settlements[p.id.toString()]) return false;
        const dx = v.x - cx, dy = v.y - cy;
        return Math.sqrt(dx * dx + dy * dy) <= HEX_SIZE + 2;
      });
    });
    setGame(prev => {
      const newGame = {
        ...prev,
        board: {
          ...prev.board,
          hexes: prev.board.hexes.map(h => ({ ...h, hasRobber: h.id === hexId })),
        },
        selectedHexForRobber: hex,
      };
      addLog(newGame, `${prev.players[prev.currentPlayer].name} moved the robber`);
      return newGame;
    });
    if (adjacent.length === 0) return;
    if (adjacent.length === 1) {
      handleSteal(adjacent[0].id);
    } else {
      setStealCandidates(adjacent);
    }
  };

  const handleSteal = (fromPlayerId: number) => {
    setStealCandidates([]);
    setGame(prev => {
      const fromPlayer = prev.players[fromPlayerId];
      const toPlayer = prev.players[prev.currentPlayer];
      const resources = (['wood', 'brick', 'sheep', 'wheat', 'ore'] as Resource[]).filter(
        r => (fromPlayer.resources[r] || 0) > 0
      );
      if (resources.length === 0) return prev;
      const res = resources[Math.floor(Math.random() * resources.length)];
      const newGame = {
        ...prev,
        players: prev.players.map(p => {
          if (p.id === fromPlayerId) return { ...p, resources: { ...p.resources, [res]: (p.resources[res] || 0) - 1 } };
          if (p.id === prev.currentPlayer) return { ...p, resources: { ...p.resources, [res]: (p.resources[res] || 0) + 1 } };
          return p;
        }),
      };
      addLog(newGame, `${toPlayer.name} stole a resource from ${fromPlayer.name}`);
      return newGame;
    });
  };

  const handleUpgradeCity = (vertexId: string) => {
    if (!canBuildCity) { setBuildError('Not enough resources! Need 2🌾3⛏️'); return; }
    const player = currentPlayer;
    setGame(prev => {
      const newGame = {
        ...prev,
        board: {
          ...prev.board,
          vertices: prev.board.vertices.map(v =>
            v.id !== vertexId ? v
              : { ...v, settlements: { ...v.settlements, [player.id]: 'city' as const } }
          ),
        },
        players: prev.players.map(p =>
          p.id !== player.id ? p : {
            ...p,
            resources: {
              ...p.resources,
              wheat: (p.resources.wheat || 0) - 2,
              ore: (p.resources.ore || 0) - 3,
            },
            pieces: { ...p.pieces, cities: p.pieces.cities - 1, settlements: p.pieces.settlements + 1 },
          }
        ),
      };
      addLog(newGame, `${player.name} upgraded to a city`);
      return newGame;
    });
    setBuildingMode(null);
  };

  // ── Rendering ────────────────────────────────────────────────────────────────

  const renderHex = (hex: Hex) => {
    const cx = HEX_SIZE * 1.5 * hex.q;
    const cy = HEX_SIZE * (Math.sqrt(3) / 2 * hex.q + Math.sqrt(3) * hex.r);
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      pts.push(`${cx + HEX_SIZE * Math.cos(a)},${cy + HEX_SIZE * Math.sin(a)}`);
    }

    const hasNumber = Boolean(hex.number);
    const isHighNumber = hex.number === 6 || hex.number === 8;
    const numColor = isHighNumber ? '#c0392b' : '#1a1a2e';
    const dots = hex.number ? (PROBABILITY_DOTS[hex.number] ?? 0) : 0;
    const dotSpacing = 6;
    const totalDotWidth = (dots - 1) * dotSpacing;

    // Illustrated emoji — position depends on whether there's a number token
    const tileEmojis = HEX_TILE_EMOJI[hex.resource];
    const emojiY = hasNumber ? cy - 16 : cy + 4;

    return (
      <g key={hex.id}>
        <polygon points={pts.join(' ')} fill={HEX_COLOR[hex.resource]} stroke="#3a200a" strokeWidth="3" className="hex" />

        {/* Tile art — emoji spread across the hex, no text labels */}
        {tileEmojis.length === 1 && (
          <text x={cx} y={emojiY + 10} textAnchor="middle" fontSize="28" style={{ userSelect: 'none' }}>
            {tileEmojis[0]}
          </text>
        )}
        {tileEmojis.length === 2 && (
          <>
            <text x={cx - 13} y={emojiY + 8} textAnchor="middle" fontSize="22" style={{ userSelect: 'none' }}>{tileEmojis[0]}</text>
            <text x={cx + 13} y={emojiY + 8} textAnchor="middle" fontSize="22" style={{ userSelect: 'none' }}>{tileEmojis[1]}</text>
          </>
        )}
        {tileEmojis.length === 3 && (
          <>
            <text x={cx - 18} y={emojiY + 4} textAnchor="middle" fontSize="18" style={{ userSelect: 'none' }}>{tileEmojis[0]}</text>
            <text x={cx}      y={emojiY - 4} textAnchor="middle" fontSize="18" style={{ userSelect: 'none' }}>{tileEmojis[1]}</text>
            <text x={cx + 18} y={emojiY + 4} textAnchor="middle" fontSize="18" style={{ userSelect: 'none' }}>{tileEmojis[2]}</text>
          </>
        )}

        {/* Number token with probability dots */}
        {hasNumber && (
          <g>
            {/* Token background circle */}
            <circle cx={cx} cy={cy + 14} r={19} fill={hex.hasRobber ? '#333' : '#f5e6c8'} stroke="#8b6914" strokeWidth="1.5" />
            {/* The number */}
            <text x={cx} y={cy + 10} textAnchor="middle" fill={numColor} fontSize={isHighNumber ? '15' : '14'} fontWeight="bold" style={{ userSelect: 'none' }}>
              {hex.number}
            </text>
            {/* Probability dots below the number */}
            {Array.from({ length: dots }).map((_, i) => (
              <circle
                key={i}
                cx={cx - totalDotWidth / 2 + i * dotSpacing}
                cy={cy + 22}
                r={2}
                fill={isHighNumber ? '#c0392b' : '#1a1a2e'}
              />
            ))}
          </g>
        )}

        {/* Robber on desert (no number token) */}
        {hex.hasRobber && !hasNumber && (
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize="22" style={{ userSelect: 'none' }}>☠️</text>
        )}
      </g>
    );
  };

  const renderPorts = () =>
    game.board.ports.map(port => {
      const { x1, y1, x2, y2, ox, oy } = portPixels(port);
      const icon = PORT_ICON[port.resource] ?? '⚓';
      const label = `${port.ratio}:1`;
      return (
        <g key={port.id}>
          {/* Pier lines from vertices to dock */}
          <line x1={x1} y1={y1} x2={ox} y2={oy} stroke="#8b6914" strokeWidth="3" strokeDasharray="5,3" opacity={0.8} />
          <line x1={x2} y1={y2} x2={ox} y2={oy} stroke="#8b6914" strokeWidth="3" strokeDasharray="5,3" opacity={0.8} />
          {/* Dock circle */}
          <circle cx={ox} cy={oy} r={19} fill="#1a3a5c" stroke="#c8a228" strokeWidth="2" />
          {/* Icon */}
          <text x={ox} y={oy - 3} textAnchor="middle" fontSize="13" style={{ userSelect: 'none' }}>{icon}</text>
          {/* Ratio label */}
          <text x={ox} y={oy + 12} textAnchor="middle" fontSize="9" fill="#ffd700" fontWeight="bold" style={{ userSelect: 'none' }}>{label}</text>
        </g>
      );
    });

  const renderSettlements = () =>
    game.board.vertices.flatMap(vertex =>
      Object.entries(vertex.settlements).filter(([, t]) => t).map(([pid, type]) => {
        const p = game.players[parseInt(pid)];
        const cx = vertex.x, cy = vertex.y;
        const key = `${vertex.id}-${pid}`;

        if (type === 'city') {
          // Castle: wide rectangular walls + 3 battlements (merlons) across the top
          const wx = cx - 12, wy = cy - 5;  // wall top-left
          const ww = 24, wh = 14;           // wall size
          const mh = 6, mw = 5;             // merlon height & width
          // 3 merlons evenly spaced across the wall top
          const mPositions = [wx + 2, wx + 9, wx + 17];
          return (
            <g key={key}>
              {/* Main wall */}
              <rect x={wx} y={wy} width={ww} height={wh}
                fill={p.color} stroke="#000" strokeWidth="1.5" />
              {/* Bottom edge line for depth */}
              <rect x={wx} y={wy + wh - 2} width={ww} height={2}
                fill="rgba(0,0,0,0.25)" />
              {/* Battlements */}
              {mPositions.map((mx, i) => (
                <rect key={i} x={mx} y={wy - mh} width={mw} height={mh}
                  fill={p.color} stroke="#000" strokeWidth="1.5" />
              ))}
              {/* Arrow-slit window */}
              <rect x={cx - 1} y={wy + 3} width={2} height={5}
                fill="rgba(0,0,0,0.45)" />
            </g>
          );
        }

        // Settlement: house with pitched roof
        const bx = cx - 8, by = cy - 4; // wall top-left
        const bw = 16, bh = 10;         // wall size
        const roofPts = `${bx - 3},${by} ${cx},${by - 9} ${bx + bw + 3},${by}`;
        return (
          <g key={key}>
            {/* Walls */}
            <rect x={bx} y={by} width={bw} height={bh}
              fill={p.color} stroke="#000" strokeWidth="1.5" />
            {/* Door */}
            <rect x={cx - 2} y={by + bh - 5} width={4} height={5}
              fill="rgba(0,0,0,0.35)" />
            {/* Roof */}
            <polygon points={roofPts}
              fill={p.color} stroke="#000" strokeWidth="1.5" />
          </g>
        );
      })
    );

  const renderRoads = () =>
    game.board.edges.flatMap(edge =>
      Object.entries(edge.roads).filter(([, t]) => t).map(([pid]) => {
        const p = game.players[parseInt(pid)];
        const x1 = edge.x1, y1 = edge.y1, x2 = edge.x2, y2 = edge.y2;
        return (
          <g key={`${edge.id}-${pid}`}>
            {/* Dark border for depth */}
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="rgba(0,0,0,0.55)" strokeWidth="11" strokeLinecap="round" />
            {/* Main road color */}
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={p.color} strokeWidth="8" strokeLinecap="round" />
            {/* Dashed highlight — gives a plank/cobblestone texture */}
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="rgba(255,255,255,0.22)" strokeWidth="3"
              strokeLinecap="round" strokeDasharray="5 7" />
          </g>
        );
      })
    );

  const renderBuildableSpots = () => {
    // Setup phase — auto-show spots for the human
    if (isSetup && isHumanTurn) {
      if (game.setupStep === 'settlement') {
        return getValidSettlementVertices(game).map(v => (
          <circle key={`spot-${v.id}`} cx={v.x} cy={v.y} r={13}
            fill="rgba(255,255,255,0.25)" stroke="#27ae60" strokeWidth="3" style={{ cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); handlePlaceSettlement(v.id); }} />
        ));
      }
      return getValidRoadEdgesSetup(game).map(e => (
        <line key={`spot-${e.id}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
          stroke="rgba(255,255,255,0.55)" strokeWidth="10" strokeLinecap="round" style={{ cursor: 'pointer' }}
          onClick={ev => { ev.stopPropagation(); handlePlaceRoad(e.id); }} />
      ));
    }

    // Playing phase manual build mode
    if (!buildingMode || !isHumanTurn || isSetup) return null;

    if (buildingMode === 'settlement') {
      return getValidSettlementVertices(game).map(v => (
        <circle key={`spot-${v.id}`} cx={v.x} cy={v.y} r={13}
          fill="rgba(255,255,255,0.25)" stroke="#27ae60" strokeWidth="3" style={{ cursor: 'pointer' }}
          onClick={e => { e.stopPropagation(); handlePlaceSettlementPlaying(v.id); }} />
      ));
    }
    if (buildingMode === 'road') {
      return getValidRoadEdges(game).map(e => (
        <line key={`spot-${e.id}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
          stroke="rgba(255,255,255,0.55)" strokeWidth="10" strokeLinecap="round" style={{ cursor: 'pointer' }}
          onClick={ev => { ev.stopPropagation(); handlePlaceRoadPlaying(e.id); }} />
      ));
    }
    if (buildingMode === 'city') {
      const cityTargets = game.board.vertices.filter(
        v => v.settlements[game.currentPlayer.toString()] === 'settlement'
      );
      return cityTargets.map(v => (
        <circle key={`spot-${v.id}`} cx={v.x} cy={v.y} r={16}
          fill="rgba(255,215,0,0.35)" stroke="#f39c12" strokeWidth="3" style={{ cursor: 'pointer' }}
          onClick={e => { e.stopPropagation(); handleUpgradeCity(v.id); }} />
      ));
    }
    return null;
  };

  const renderRobberTargets = () => {
    if (!robbingMode || !isHumanTurn) return null;
    return game.board.hexes
      .filter(h => !h.hasRobber)
      .map(hex => {
        const pts: string[] = [];
        const { cx, cy } = hexCenterPx(hex.q, hex.r);
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          pts.push(`${cx + HEX_SIZE * Math.cos(a)},${cy + HEX_SIZE * Math.sin(a)}`);
        }
        return (
          <polygon key={`robber-${hex.id}`} points={pts.join(' ')}
            fill="rgba(180,0,0,0.22)" stroke="#e74c3c" strokeWidth="2"
            style={{ cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); handleMoveRobber(hex.id); }} />
        );
      });
  };

  const getDisplayVP = (p: typeof currentPlayer) => calculateVP(p, game);
  const setupOrder = game.phase === 'setup1' ? [0,1,2,3] : game.phase === 'setup2' ? [3,2,1,0] : [];

  // ── JSX ──────────────────────────────────────────────────────────────────────

  return (
    <div className="game">
      <header className="header">
        <h1>🎲 Settlers of Catan</h1>
        <button className="btn btn-secondary" onClick={handleNewGame} style={{ maxWidth: '120px', margin: '10px auto 0' }}>
          New Game
        </button>
        <div className="turn-info">
          {isSetup
            ? `Setup ${game.phase === 'setup1' ? '(Round 1 →)' : '(Round 2 ←)'} — ${currentPlayer?.name}`
            : `Turn ${game.turn} | ${currentPlayer?.name}'s Turn`}
        </div>
      </header>

      {/* Player Stats */}
      <div className="player-bar">
        {game.players.map(player => (
          <div key={player.id} className={`player-card ${player.id === game.currentPlayer ? 'active' : ''}`}
            style={{ borderColor: player.color }}>
            <div className="player-name" style={{ color: player.color }}>{player.name}</div>
            <div className="player-vp">
              VP: {getDisplayVP(player)}
              {player.devCards.length > 0 && (
                <span style={{ marginLeft: '8px', fontSize: '0.8em', color: '#ccc' }}>🃏×{player.devCards.length}</span>
              )}
              {game.longestRoadHolder === player.id && (
                <span style={{ marginLeft: '6px', fontSize: '0.8em' }} title="Longest Road">🛣️</span>
              )}
              {game.largestArmyHolder === player.id && (
                <span style={{ marginLeft: '4px', fontSize: '0.8em' }} title="Largest Army">⚔️</span>
              )}
            </div>
            <div className="player-resources">
              {RESOURCES.map(res => {
                const count = player.resources[res] || 0;
                return count > 0 ? (
                  <span key={res} className="resource">{HEX_ICON[res]} {count}</span>
                ) : null;
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Main Game Area */}
      <div className="game-area">
        <div className="board-container">
          {/* viewBox expanded to show port symbols outside the hex grid */}
          <svg width="620" height="620" viewBox="-310 -310 620 620" className="board"
            style={{ fontFamily: "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif" }}
            onClick={() => {
              // Cancel building mode on background click, but NOT during road building card —
              // player must place all roads (clicking outside would forfeit a free road).
              if (buildingMode && roadBuildingRoadsLeft === 0) {
                setBuildingMode(null);
              }
            }}>
            {game.board.hexes.map(renderHex)}
            {renderPorts()}
            {renderRoads()}
            {renderSettlements()}
            {renderBuildableSpots()}
            {renderRobberTargets()}
          </svg>
        </div>

        {/* Action Panel */}
        <div className="action-panel">
          {isSetup ? (
            <>
              <h3>🏗️ Setup Phase</h3>
              <div style={{ background: '#1a2a3a', borderRadius: '8px', padding: '12px', marginBottom: '15px' }}>
                <div style={{ marginBottom: '8px', fontSize: '0.9rem', color: '#aaa' }}>
                  {game.phase === 'setup1' ? 'Round 1 — Clockwise ➜' : 'Round 2 — Counter-clockwise ←'}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {setupOrder.map(pid => (
                    <span key={pid} style={{
                      padding: '4px 10px', borderRadius: '6px',
                      background: pid === game.currentPlayer ? game.players[pid].color : 'rgba(255,255,255,0.1)',
                      color: pid === game.currentPlayer ? '#000' : game.players[pid].color,
                      fontWeight: pid === game.currentPlayer ? 'bold' : 'normal',
                      border: `2px solid ${game.players[pid].color}`, fontSize: '0.85rem',
                    }}>{game.players[pid].name}</span>
                  ))}
                </div>
              </div>
              {isHumanTurn ? (
                <div style={{ padding: '12px', background: '#27ae60', borderRadius: '8px', textAlign: 'center' }}>
                  <strong>
                    {game.setupStep === 'settlement'
                      ? '🏠 Click a green spot to place your settlement'
                      : '🛣️ Click a road spot adjacent to your settlement'}
                  </strong>
                </div>
              ) : (
                <div style={{ padding: '12px', background: '#2c3e50', borderRadius: '8px', textAlign: 'center', color: '#aaa' }}>
                  ⏳ {currentPlayer?.name} is placing…
                </div>
              )}
            </>
          ) : (
            <>
              <h3>Actions</h3>

              {/* Dev Cards Panel — shown first so it's always visible */}
              {isHumanTurn && !isSetup && (
                <div style={{ background: '#1a2a3a', border: '2px solid #8b6914', borderRadius: '8px', padding: '10px', marginBottom: '10px' }}>
                  <h4 style={{ margin: '0 0 8px 0', color: '#ffd700' }}>🃏 Dev Cards {currentPlayer.devCards.length > 0 && `(${currentPlayer.devCards.length})`}</h4>
                  {currentPlayer.devCards.length === 0 ? (
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>None — buy one in the Build section below</div>
                  ) : devCardMode === 'plenty' ? (
                    <div>
                      <div style={{ fontSize: '0.85rem', color: '#ffd700', marginBottom: '6px' }}>
                        🌟 Year of Plenty — pick {2 - yearOfPlentyPicks.length} resource{2 - yearOfPlentyPicks.length !== 1 ? 's' : ''}:
                        {yearOfPlentyPicks.length > 0 && <span> {yearOfPlentyPicks.map(r => HEX_ICON[r]).join(' ')}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
                        {RESOURCES.map(r => (
                          <button key={r} onClick={() => handlePickYearOfPlentyResource(r)}
                            style={{ padding: '5px 9px', background: '#27ae60', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '1rem' }}>
                            {HEX_ICON[r]}
                          </button>
                        ))}
                      </div>
                      <button onClick={() => { setDevCardMode(null); setYearOfPlentyPicks([]); }}
                        style={{ fontSize: '0.75rem', padding: '3px 8px', background: '#555', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  ) : devCardMode === 'monopoly' ? (
                    <div>
                      <div style={{ fontSize: '0.85rem', color: '#ffd700', marginBottom: '6px' }}>💰 Monopoly — pick a resource to steal from all players:</div>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
                        {RESOURCES.map(r => (
                          <button key={r} onClick={() => handlePlayMonopoly(r)}
                            style={{ padding: '5px 9px', background: '#e74c3c', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '1rem' }}
                            title={r}>
                            {HEX_ICON[r]}
                          </button>
                        ))}
                      </div>
                      <button onClick={() => setDevCardMode(null)}
                        style={{ fontSize: '0.75rem', padding: '3px 8px', background: '#555', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {(['knight', 'road', 'plenty', 'monopoly', 'victory'] as const).map(cardType => {
                        const count = currentPlayer.devCards.filter(c => c === cardType).length;
                        if (count === 0) return null;
                        const canPlay = cardType !== 'victory' && !devCardPlayedThisTurn && !mustMoveRobber && game.phase === 'playing';
                        const cardLabel: Record<string, string> = {
                          knight: '⚔️ Knight',
                          road: '🛣️ Road Building',
                          plenty: '🌟 Year of Plenty',
                          monopoly: '💰 Monopoly',
                          victory: '🏆 Victory Point',
                        };
                        const cardDesc: Record<string, string> = {
                          knight: 'Move robber, steal a resource',
                          road: 'Place 2 free roads',
                          plenty: 'Take any 2 resources',
                          monopoly: 'Steal all of 1 resource',
                          victory: 'Counts as 1 VP',
                        };
                        return (
                          <div key={cardType} style={{ background: '#253545', borderRadius: '5px', padding: '6px 8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div>
                                <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{cardLabel[cardType]}</span>
                                {count > 1 && <span style={{ color: '#aaa', marginLeft: '4px' }}>×{count}</span>}
                                {cardType === 'victory' && <span style={{ color: '#ffd700', marginLeft: '4px' }}>(+{count} VP)</span>}
                              </div>
                              {canPlay && (
                                <button
                                  onClick={() => {
                                    if (cardType === 'knight') handlePlayKnight();
                                    else if (cardType === 'road') handlePlayRoadBuilding();
                                    else if (cardType === 'plenty') setDevCardMode('plenty');
                                    else if (cardType === 'monopoly') setDevCardMode('monopoly');
                                  }}
                                  style={{ padding: '4px 12px', background: '#e67e22', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                                >
                                  Play
                                </button>
                              )}
                              {cardType !== 'victory' && devCardPlayedThisTurn && (
                                <span style={{ fontSize: '0.75rem', color: '#888' }}>used this turn</span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '2px' }}>{cardDesc[cardType]}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Robber prompt */}
              {robbingMode && isHumanTurn && (
                <div style={{ padding: '12px', background: '#7b1a1a', borderRadius: '8px', marginBottom: '10px', textAlign: 'center' }}>
                  <strong>☠️ You rolled 7! Click any hex to move the robber.</strong>
                </div>
              )}

              {/* Steal selection */}
              {stealCandidates.length > 0 && (
                <div style={{ padding: '12px', background: '#2c3e50', borderRadius: '8px', marginBottom: '10px' }}>
                  <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>🗡️ Steal from:</div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {stealCandidates.map(p => (
                      <button key={p.id} onClick={() => handleSteal(p.id)}
                        style={{ padding: '6px 14px', background: p.color, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', color: '#000' }}>
                        {p.name} ({getTotalResources(p)} cards)
                      </button>
                    ))}
                    <button onClick={() => setStealCandidates([])}
                      style={{ padding: '6px 10px', background: '#555', border: 'none', borderRadius: '6px', cursor: 'pointer', color: '#fff' }}>
                      Skip
                    </button>
                  </div>
                </div>
              )}

              {/* Dice */}
              <div className="dice-section">
                {game.dice ? (
                  <div className="dice-result">
                    <span className="die">{game.dice[0]}</span>
                    <span className="die">{game.dice[1]}</span>
                    <span className="dice-sum">= {game.dice[0] + game.dice[1]}</span>
                  </div>
                ) : (
                  <button className="btn btn-primary" onClick={handleRollDice} disabled={!isHumanTurn}>
                    🎲 Roll Dice
                  </button>
                )}
              </div>

              {/* Error message */}
              {buildError && (
                <div style={{ padding: '8px', background: '#c0392b', borderRadius: '6px', marginBottom: '10px', fontSize: '0.85rem', textAlign: 'center' }}>
                  ⚠️ {buildError}
                </div>
              )}

              {/* Building mode indicator */}
              {buildingMode && (
                <div style={{ padding: '10px', background: '#27ae60', borderRadius: '8px', marginBottom: '10px', textAlign: 'center' }}>
                  <strong>🏗️ Placing {buildingMode}</strong>
                  {roadBuildingRoadsLeft > 0 && (
                    <span> — Road Building: {roadBuildingRoadsLeft} free road{roadBuildingRoadsLeft > 1 ? 's' : ''} left</span>
                  )}
                  <br /><small>Click a highlighted spot — or the board to cancel</small>
                </div>
              )}

              {/* Build buttons */}
              <div className="build-section">
                <h4>Build</h4>
                <button
                  className={`btn ${buildingMode === 'road' ? 'active' : ''} ${!canBuildRoad ? 'cannot-afford' : ''}`}
                  onClick={() => handleBuildToggle('road')} disabled={!isHumanTurn || mustMoveRobber || roadBuildingRoadsLeft > 0}
                  title={!canBuildRoad ? 'Need 1🌲 1🧱' : ''}
                >
                  🛣️ Road {!canBuildRoad && <span style={{ opacity: 0.6, fontSize: '0.8em' }}>(need 1🌲1🧱)</span>}
                </button>
                <button
                  className={`btn ${buildingMode === 'settlement' ? 'active' : ''} ${!canBuildSettlement ? 'cannot-afford' : ''}`}
                  onClick={() => handleBuildToggle('settlement')} disabled={!isHumanTurn || mustMoveRobber}
                >
                  🏠 Settlement {!canBuildSettlement && <span style={{ opacity: 0.6, fontSize: '0.8em' }}>(need 1🌲1🧱1🌾1🐑)</span>}
                </button>
                <button
                  className={`btn ${buildingMode === 'city' ? 'active' : ''} ${!canBuildCity ? 'cannot-afford' : ''}`}
                  onClick={() => handleBuildToggle('city')} disabled={!isHumanTurn || mustMoveRobber}
                >
                  🏰 City {!canBuildCity && <span style={{ opacity: 0.6, fontSize: '0.8em' }}>(need 2🌾3⛏️)</span>}
                </button>
                <button
                  className={`btn ${!canBuildDevCard ? 'cannot-afford' : ''}`}
                  onClick={handleBuyDevCard} disabled={!isHumanTurn || mustMoveRobber || !canBuildDevCard}
                  title="Need 1🌾 1🐑 1⛏️"
                >
                  🃏 Dev Card {!canBuildDevCard && <span style={{ opacity: 0.6, fontSize: '0.8em' }}>(need 1🌾1🐑1⛏️)</span>}
                </button>
              </div>

              {/* Player Trade */}
              {isHumanTurn && game.dice && !mustMoveRobber && (
                <div className="trade-section">
                  <h4>🤝 Trade with Players</h4>
                  {!showPlayerTrade && playerTradeResponses.length === 0 && (
                    <button className="btn" onClick={() => setShowPlayerTrade(true)} style={{ marginBottom: 0 }}>
                      Propose a Trade
                    </button>
                  )}
                  {showPlayerTrade && playerTradeResponses.length === 0 && (
                    <div>
                      <div style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.8rem', color: '#bbb', marginBottom: '4px' }}>You give:</div>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {RESOURCES.map(r => {
                              const offered = playerTradeOffer[r] || 0;
                              const have = currentPlayer?.resources[r] || 0;
                              return (
                                <div key={r} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                  <button
                                    onClick={() => { if (offered < have) setPlayerTradeOffer(prev => ({ ...prev, [r]: offered + 1 })); }}
                                    style={{ padding: '4px 6px', fontSize: '0.85rem', border: offered > 0 ? '2px solid #e67e22' : '2px solid transparent', borderRadius: '5px', background: offered > 0 ? '#7a3d0a' : have > 0 ? '#2c3e50' : '#1a1a2e', color: have > 0 ? '#fff' : '#555', cursor: have > 0 ? 'pointer' : 'default', minWidth: '38px' }}
                                    title={`Have ${have}`}
                                  >
                                    {HEX_ICON[r]}{offered > 0 ? ` ×${offered}` : ''}
                                  </button>
                                  {offered > 0 && (
                                    <button onClick={() => setPlayerTradeOffer(prev => ({ ...prev, [r]: offered - 1 }))}
                                      style={{ fontSize: '0.65rem', padding: '1px 6px', background: '#555', border: 'none', borderRadius: '3px', color: '#fff', cursor: 'pointer' }}>−</button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.8rem', color: '#bbb', marginBottom: '4px' }}>You get:</div>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {RESOURCES.map(r => {
                              const requested = playerTradeRequest[r] || 0;
                              return (
                                <div key={r} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                  <button
                                    onClick={() => setPlayerTradeRequest(prev => ({ ...prev, [r]: requested + 1 }))}
                                    style={{ padding: '4px 6px', fontSize: '0.85rem', border: requested > 0 ? '2px solid #27ae60' : '2px solid transparent', borderRadius: '5px', background: requested > 0 ? '#0e4d28' : '#2c3e50', color: '#fff', cursor: 'pointer', minWidth: '38px' }}
                                  >
                                    {HEX_ICON[r]}{requested > 0 ? ` ×${requested}` : ''}
                                  </button>
                                  {requested > 0 && (
                                    <button onClick={() => setPlayerTradeRequest(prev => ({ ...prev, [r]: requested - 1 }))}
                                      style={{ fontSize: '0.65rem', padding: '1px 6px', background: '#555', border: 'none', borderRadius: '3px', color: '#fff', cursor: 'pointer' }}>−</button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn btn-primary"
                          onClick={handleProposePlayerTrade}
                          disabled={RESOURCES.every(r => !(playerTradeOffer[r])) || RESOURCES.every(r => !(playerTradeRequest[r]))}
                          style={{ flex: 1, marginBottom: 0 }}>
                          Send Proposal
                        </button>
                        <button onClick={() => { setShowPlayerTrade(false); setPlayerTradeOffer({}); setPlayerTradeRequest({}); }}
                          style={{ padding: '6px 12px', background: '#555', border: 'none', borderRadius: '5px', color: '#fff', cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {playerTradeResponses.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.85rem', color: '#ffd700', marginBottom: '8px' }}>
                        Offering: {RESOURCES.filter(r => playerTradeOffer[r]).map(r => `${playerTradeOffer[r]}${HEX_ICON[r]}`).join(' ')} → Getting: {RESOURCES.filter(r => playerTradeRequest[r]).map(r => `${playerTradeRequest[r]}${HEX_ICON[r]}`).join(' ')}
                      </div>
                      {playerTradeResponses.map(({ playerId, accepts }) => {
                        const p = game.players[playerId];
                        return (
                          <div key={playerId} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                            <span style={{ color: p.color, fontWeight: 'bold', minWidth: '50px' }}>{p.name}</span>
                            {accepts ? (
                              <button onClick={() => handleExecutePlayerTrade(playerId)}
                                style={{ padding: '4px 12px', background: '#27ae60', border: 'none', borderRadius: '5px', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>
                                ✓ Accepts — Trade!
                              </button>
                            ) : (
                              <span style={{ color: '#888', fontSize: '0.85rem' }}>✗ Declines</span>
                            )}
                          </div>
                        );
                      })}
                      <button onClick={() => { setPlayerTradeResponses([]); setShowPlayerTrade(true); }}
                        style={{ marginTop: '4px', padding: '4px 10px', background: '#555', border: 'none', borderRadius: '5px', color: '#fff', cursor: 'pointer', fontSize: '0.8rem' }}>
                        ← Edit Offer
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Bank Trade */}
              <div className="trade-section">
                <h4>🏦 Trade with Bank</h4>
                <div style={{ fontSize: '0.75rem', color: '#aaa', marginBottom: '6px' }}>
                  Your ratios: {RESOURCES.map(r => `${HEX_ICON[r]}=${tradeRatios[r] || 4}:1`).join('  ')}
                </div>

                {/* Give row — each tap adds 1 resource; you need ratio-many to earn a credit */}
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ fontSize: '0.8rem', color: '#bbb', marginBottom: '4px' }}>Give (tap to add +1, tap − to remove):</div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {RESOURCES.map(r => {
                      const ratio = tradeRatios[r] || 4;
                      const offered = tradeOffer[r] || 0;
                      const have = currentPlayer?.resources[r] || 0;
                      const canAdd = offered < have;
                      const credits = Math.floor(offered / ratio);
                      return (
                        <div key={r} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                          <button
                            onClick={() => {
                              if (!isHumanTurn || mustMoveRobber || !canAdd) return;
                              setTradeOffer(prev => ({ ...prev, [r]: offered + 1 }));
                            }}
                            disabled={!isHumanTurn || mustMoveRobber}
                            style={{
                              padding: '4px 7px', fontSize: '0.8rem',
                              border: offered > 0 ? '2px solid #e67e22' : '2px solid transparent',
                              borderRadius: '5px',
                              background: offered > 0 ? '#7a3d0a' : canAdd ? '#2c3e50' : '#1a1a2e',
                              color: canAdd || offered > 0 ? '#fff' : '#555',
                              cursor: canAdd ? 'pointer' : 'default', minWidth: '44px',
                            }}
                            title={`Have ${have}, giving ${offered} (${ratio}:1)`}
                          >
                            {HEX_ICON[r]}{offered > 0 ? ` ×${offered}` : ''}
                            <div style={{ fontSize: '0.6rem', color: credits > 0 ? '#ffd700' : '#888' }}>
                              {credits > 0 ? `=${credits}cr` : `${ratio}:1`}
                            </div>
                          </button>
                          {offered > 0 && (
                            <button
                              onClick={() => {
                                const newOffered = offered - 1;
                                setTradeOffer(prev => ({ ...prev, [r]: newOffered }));
                                const newCredits = RESOURCES.reduce((s, r2) => {
                                  const rat = tradeRatios[r2] || 4;
                                  return s + Math.floor((r2 === r ? newOffered : (tradeOffer[r2] || 0)) / rat);
                                }, 0);
                                if (totalRequestAmount > newCredits) setTradeRequest({});
                              }}
                              style={{ fontSize: '0.7rem', padding: '1px 8px', background: '#555', border: 'none', borderRadius: '3px', color: '#fff', cursor: 'pointer' }}
                            >
                              −
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Trade credits indicator */}
                {RESOURCES.some(r => (tradeOffer[r] || 0) > 0) && (
                  <div style={{ fontSize: '0.8rem', marginBottom: '6px', padding: '4px 6px', background: '#1a2a1a', borderRadius: '4px' }}>
                    {totalOfferCredits > 0
                      ? <span style={{ color: '#27ae60', fontWeight: 'bold' }}>✓ {totalOfferCredits} trade credit{totalOfferCredits > 1 ? 's' : ''} — select what to receive below</span>
                      : <span style={{ color: '#e67e22' }}>Need {RESOURCES.filter(r => (tradeOffer[r] || 0) > 0).map(r => `${(tradeRatios[r]||4) - (tradeOffer[r]||0)} more ${HEX_ICON[r]}`).join(', ')} for a credit</span>
                    }
                    {totalOfferCredits > 0 && totalRequestAmount > 0 && (
                      <span style={{ color: '#aaa' }}> — used: {totalRequestAmount}/{totalOfferCredits}</span>
                    )}
                  </div>
                )}

                {/* Get row — always visible; buttons gray out until you have credits */}
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: '#bbb', marginBottom: '4px' }}>
                    Get (tap to add):{totalOfferCredits === 0 && <span style={{ color: '#666', marginLeft: '6px' }}>offer resources above first</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {RESOURCES.map(r => {
                      const requested = tradeRequest[r] || 0;
                      const canAdd = totalRequestAmount < totalOfferCredits;
                      return (
                        <div key={r} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                          <button
                            onClick={() => {
                              if (!isHumanTurn || mustMoveRobber || !canAdd) return;
                              setTradeRequest(prev => ({ ...prev, [r]: requested + 1 }));
                            }}
                            disabled={!isHumanTurn || mustMoveRobber}
                            style={{
                              padding: '4px 7px', fontSize: '0.8rem', border: requested > 0 ? '2px solid #27ae60' : '2px solid transparent',
                              borderRadius: '5px',
                              background: requested > 0 ? '#0e4d28' : totalOfferCredits > 0 && canAdd ? '#2c3e50' : '#1a1a2e',
                              color: totalOfferCredits > 0 || requested > 0 ? '#fff' : '#555',
                              cursor: canAdd && totalOfferCredits > 0 ? 'pointer' : 'default', minWidth: '44px',
                              opacity: totalOfferCredits > 0 ? 1 : 0.4,
                            }}
                          >
                            {HEX_ICON[r]}{requested > 0 ? ` ×${requested}` : ''}
                          </button>
                          {requested > 0 && (
                            <button
                              onClick={() => setTradeRequest(prev => ({ ...prev, [r]: requested - 1 }))}
                              style={{ fontSize: '0.7rem', padding: '1px 8px', background: '#555', border: 'none', borderRadius: '3px', color: '#fff', cursor: 'pointer' }}
                            >
                              −
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Execute + clear */}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {totalOfferCredits > 0 && totalRequestAmount > 0 && (
                    <button
                      className="btn btn-primary"
                      onClick={handleBankTrade}
                      disabled={totalRequestAmount > totalOfferCredits}
                      style={{ marginBottom: 0, flex: 1 }}
                    >
                      Trade {RESOURCES.filter(r => (tradeOffer[r]||0) > 0).map(r => `${tradeOffer[r]}${HEX_ICON[r]}`).join('+')} → {RESOURCES.filter(r => (tradeRequest[r]||0) > 0).map(r => `${tradeRequest[r]}${HEX_ICON[r]}`).join('+')}
                    </button>
                  )}
                  {(totalOfferCredits > 0 || totalRequestAmount > 0) && (
                    <button
                      onClick={() => { setTradeOffer({}); setTradeRequest({}); }}
                      style={{ padding: '6px 12px', background: '#555', border: 'none', borderRadius: '5px', color: '#fff', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <button className="btn btn-secondary" onClick={handleEndTurn} disabled={!isHumanTurn || mustMoveRobber} style={{ marginTop: '10px' }}>
                ⏭️ End Turn
              </button>
            </>
          )}
        </div>
      </div>

      {/* Game Log */}
      <div className="game-log">
        <h4>📜 Game Log</h4>
        <div className="log-entries">
          {game.log.slice(-10).map((entry, i) => (
            <div key={i} className="log-entry">
              <span className="log-turn">T{entry.turn}</span>
              <span className="log-player" style={{ color: game.players[entry.player]?.color }}>
                {game.players[entry.player]?.name}
              </span>
              <span className="log-action">{entry.action}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Game Over overlay */}
      {game.winner !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1a2a3a', padding: '48px', borderRadius: '18px', textAlign: 'center', border: `3px solid ${game.players[game.winner].color}` }}>
            <div style={{ fontSize: '3rem', marginBottom: '8px' }}>🏆</div>
            <h2 style={{ fontSize: '2rem', color: game.players[game.winner].color, marginBottom: '8px' }}>
              {game.players[game.winner].name} wins!
            </h2>
            <p style={{ color: '#aaa', marginBottom: '24px' }}>
              {calculateVP(game.players[game.winner], game)} victory points
            </p>
            <button className="btn btn-primary" onClick={handleNewGame}>
              🎲 New Game
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
