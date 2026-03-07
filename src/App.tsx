import { useState, useEffect } from 'react';
import type { GameState, Hex, Resource, Vertex, Edge, Port, Player } from './types';
import {
  createInitialGameState, rollDice, distributeResources,
  calculateVP, addLog, advanceSetupState, canAfford, BUILD_COSTS,
  getTotalResources, discardHalf,
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
  wood: '🪵', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '🪨', desert: '🏜️', gold: '💰',
};

// Large illustrated emoji shown on each hex tile — no text labels, just visual art
const HEX_TILE_EMOJI: Record<Resource, string[]> = {
  wood:   ['🌲', '🌲', '🌲'],  // three trees
  brick:  ['🧱', '⛰️'],        // brick + hill
  sheep:  ['🐑', '🌿'],        // sheep on grass
  wheat:  ['🌾', '🌾'],        // wheat sheaves
  ore:    ['⛰️', '🪨'],        // mountains + ore
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
  wood: '🪵', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '🪨', generic: '⚓',
};

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [game, setGame] = useState<GameState>(createInitialGameState());
  const [buildingMode, setBuildingMode] = useState<'road' | 'settlement' | 'city' | null>(null);
  const [tradeGive, setTradeGive] = useState<Resource | null>(null);
  const [tradeGet, setTradeGet] = useState<Resource | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  const currentPlayer = game.players[game.currentPlayer];
  const isSetup = game.phase === 'setup1' || game.phase === 'setup2';
  const isHumanTurn = currentPlayer?.isHuman;

  // Affordability checks (only relevant during playing phase)
  const canBuildRoad = canAfford(currentPlayer, BUILD_COSTS.road);
  const canBuildSettlement = canAfford(currentPlayer, BUILD_COSTS.settlement);
  const canBuildCity = canAfford(currentPlayer, BUILD_COSTS.city);

  const tradeRatios = isHumanTurn ? getTradeRatios(game, game.currentPlayer) : {};

  // Robber state: human moves robber after rolling 7
  const [robbingMode, setRobbingMode] = useState(false);
  const [stealCandidates, setStealCandidates] = useState<Player[]>([]);

  // Clear build error after 3 seconds
  useEffect(() => {
    if (!buildError) return;
    const t = setTimeout(() => setBuildError(null), 3000);
    return () => clearTimeout(t);
  }, [buildError]);

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

  // ── AI playing turn — Step 1: roll dice ─────────────────────────────────────
  useEffect(() => {
    if (game.phase !== 'playing' || game.players[game.currentPlayer]?.isHuman || game.dice !== null) return;
    const t = setTimeout(() => {
      setGame(prev => {
        if (prev.phase !== 'playing' || prev.players[prev.currentPlayer].isHuman || prev.dice !== null) return prev;
        const dice = rollDice();
        const sum = dice[0] + dice[1];
        const newGame = { ...prev, dice };
        if (sum !== 7) {
          distributeResources(newGame, sum);
        } else {
          // Discard half for anyone with 8+ cards
          for (const p of newGame.players) {
            if (getTotalResources(p) >= 8) discardHalf(newGame, p.id);
          }
        }
        addLog(newGame, `${prev.players[prev.currentPlayer].name} rolled ${dice[0]}+${dice[1]}=${sum}`);
        return newGame;
      });
    }, 600);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.currentPlayer, game.phase, game.dice]);

  // ── AI playing turn — Step 2: build decisions + end turn ────────────────────
  useEffect(() => {
    if (game.phase !== 'playing' || game.players[game.currentPlayer]?.isHuman || game.dice === null) return;
    const t = setTimeout(() => {
      setGame(prev => {
        if (prev.phase !== 'playing' || prev.players[prev.currentPlayer].isHuman || prev.dice === null) return prev;
        return aiDoFullTurn(prev);
      });
    }, 1100);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.dice, game.currentPlayer, game.phase]);

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
    if (sum === 7) setRobbingMode(true);
  };

  const handleEndTurn = () => {
    setBuildingMode(null);
    setTradeGive(null); setTradeGet(null);
    setGame(prev => ({
      ...prev,
      currentPlayer: (prev.currentPlayer + 1) % 4,
      turn: prev.turn + 1,
      dice: null,
    }));
  };

  const handleNewGame = () => {
    setBuildingMode(null); setTradeGive(null); setTradeGet(null); setBuildError(null);
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
    if (!tradeGive || !tradeGet || tradeGive === tradeGet) return;
    const ratio = tradeRatios[tradeGive] || 4;
    const player = currentPlayer;
    if ((player.resources[tradeGive] || 0) < ratio) {
      setBuildError(`Need ${ratio} ${HEX_ICON[tradeGive]} to trade`);
      return;
    }
    setGame(prev => {
      const newGame = { ...prev };
      newGame.players = prev.players.map(p =>
        p.id !== player.id ? p : {
          ...p,
          resources: {
            ...p.resources,
            [tradeGive]: (p.resources[tradeGive] || 0) - ratio,
            [tradeGet!]: (p.resources[tradeGet!] || 0) + 1,
          },
        }
      );
      addLog(newGame, `${player.name} traded ${ratio}${HEX_ICON[tradeGive]} → 1${HEX_ICON[tradeGet!]}`);
      return newGame;
    });
    setTradeGive(null); setTradeGet(null);
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
        return (
          <circle key={`${vertex.id}-${pid}`} cx={vertex.x} cy={vertex.y}
            r={type === 'city' ? 14 : 10} fill={p.color} stroke="#000" strokeWidth="2" />
        );
      })
    );

  const renderRoads = () =>
    game.board.edges.flatMap(edge =>
      Object.entries(edge.roads).filter(([, t]) => t).map(([pid]) => {
        const p = game.players[parseInt(pid)];
        return (
          <line key={`${edge.id}-${pid}`} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2}
            stroke={p.color} strokeWidth="8" strokeLinecap="round" />
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
            <div className="player-vp">VP: {getDisplayVP(player)}</div>
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
            onClick={() => buildingMode && setBuildingMode(null)}>
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
                  <br /><small>Click a highlighted spot — or the board to cancel</small>
                </div>
              )}

              {/* Build buttons */}
              <div className="build-section">
                <h4>Build</h4>
                <button
                  className={`btn ${buildingMode === 'road' ? 'active' : ''} ${!canBuildRoad ? 'cannot-afford' : ''}`}
                  onClick={() => handleBuildToggle('road')} disabled={!isHumanTurn}
                  title={!canBuildRoad ? 'Need 1🌲 1🧱' : ''}
                >
                  🛣️ Road {!canBuildRoad && <span style={{ opacity: 0.6, fontSize: '0.8em' }}>(need 1🌲1🧱)</span>}
                </button>
                <button
                  className={`btn ${buildingMode === 'settlement' ? 'active' : ''} ${!canBuildSettlement ? 'cannot-afford' : ''}`}
                  onClick={() => handleBuildToggle('settlement')} disabled={!isHumanTurn}
                >
                  🏠 Settlement {!canBuildSettlement && <span style={{ opacity: 0.6, fontSize: '0.8em' }}>(need 1🌲1🧱1🌾1🐑)</span>}
                </button>
                <button
                  className={`btn ${buildingMode === 'city' ? 'active' : ''} ${!canBuildCity ? 'cannot-afford' : ''}`}
                  onClick={() => handleBuildToggle('city')} disabled={!isHumanTurn}
                >
                  🏰 City {!canBuildCity && <span style={{ opacity: 0.6, fontSize: '0.8em' }}>(need 2🌾3⛏️)</span>}
                </button>
              </div>

              {/* Bank Trade */}
              <div className="trade-section">
                <h4>🏦 Trade with Bank</h4>
                <div style={{ fontSize: '0.75rem', color: '#aaa', marginBottom: '6px' }}>
                  Your ratios: {RESOURCES.map(r => `${HEX_ICON[r]}=${tradeRatios[r] || 4}:1`).join('  ')}
                </div>
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ fontSize: '0.8rem', color: '#bbb', marginBottom: '4px' }}>Give:</div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {RESOURCES.map(r => {
                      const ratio = tradeRatios[r] || 4;
                      const have = currentPlayer?.resources[r] || 0;
                      const canGive = have >= ratio;
                      return (
                        <button key={r}
                          onClick={() => { setTradeGive(r); setTradeGet(null); }}
                          disabled={!isHumanTurn || !canGive}
                          style={{
                            padding: '4px 7px', fontSize: '0.8rem', border: 'none', borderRadius: '5px',
                            background: tradeGive === r ? '#e67e22' : canGive ? '#2c3e50' : '#1a1a2e',
                            color: canGive ? '#fff' : '#555', cursor: canGive ? 'pointer' : 'not-allowed',
                            opacity: canGive ? 1 : 0.5,
                          }}
                          title={`${have}/${ratio} ${r}`}
                        >
                          {HEX_ICON[r]}{ratio}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {tradeGive && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '0.8rem', color: '#bbb', marginBottom: '4px' }}>Get:</div>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {RESOURCES.filter(r => r !== tradeGive).map(r => (
                        <button key={r}
                          onClick={() => setTradeGet(r)}
                          disabled={!isHumanTurn}
                          style={{
                            padding: '4px 7px', fontSize: '0.8rem', border: 'none', borderRadius: '5px',
                            background: tradeGet === r ? '#27ae60' : '#2c3e50',
                            color: '#fff', cursor: 'pointer',
                          }}
                        >
                          {HEX_ICON[r]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {tradeGive && tradeGet && (
                  <button className="btn btn-primary" onClick={handleBankTrade} style={{ marginBottom: 0 }}>
                    Trade {tradeRatios[tradeGive]}× {HEX_ICON[tradeGive]} → 1× {HEX_ICON[tradeGet]}
                  </button>
                )}
              </div>

              <button className="btn btn-secondary" onClick={handleEndTurn} disabled={!isHumanTurn} style={{ marginTop: '10px' }}>
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
