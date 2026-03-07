import { useState, useEffect } from 'react';
import type { GameState, Hex, Resource, Vertex, Edge } from './types';
import {
  createInitialGameState, rollDice, distributeResources,
  calculateVP, addLog, advanceSetupState,
} from './gameState';
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

// ── Valid placement helpers ───────────────────────────────────────────────────

/** All vertices a settlement can be placed on (distance rule enforced). */
function getValidSettlementVertices(game: GameState): Vertex[] {
  const playerId = game.currentPlayer.toString();
  return game.board.vertices.filter(v => {
    if (Object.values(v.settlements).some(s => s)) return false;
    // Distance rule: no adjacent settled vertex
    for (const other of game.board.vertices) {
      if (!Object.values(other.settlements).some(s => s)) continue;
      if (distSq(v.x, v.y, other.x, other.y) < (HEX_SIZE * 1.1) ** 2) return false;
    }
    // In playing phase also require own connected road
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

/** During setup: road must touch the settlement just placed. */
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

/** During playing phase: road must connect to own road or settlement. */
function getValidRoadEdges(game: GameState): Edge[] {
  const playerId = game.currentPlayer.toString();
  return game.board.edges.filter(e => {
    if (Object.values(e.roads).some(r => r)) return false;
    const endpoints = game.board.vertices.filter(
      v => distSq(v.x, v.y, e.x1, e.y1) < 9 || distSq(v.x, v.y, e.x2, e.y2) < 9
    );
    for (const v of endpoints) {
      if (v.settlements[playerId]) return true;
    }
    for (const other of game.board.edges) {
      if (!other.roads[playerId]) continue;
      if (edgesShareEndpoint(e, other)) return true;
    }
    return false;
  });
}

/** Resources from hexes adjacent to a vertex (for setup2 income). */
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

// ── Resource display config ───────────────────────────────────────────────────

const HEX_ICON: Record<Resource, string> = {
  wood:   '🌲',
  brick:  '🧱',
  sheep:  '🐑',
  wheat:  '🌾',
  ore:    '⛏️',
  desert: '☀️',
  gold:   '💰',
};

const HEX_LABEL: Record<Resource, string> = {
  wood:   'Forest',
  brick:  'Hills',
  sheep:  'Pasture',
  wheat:  'Fields',
  ore:    'Mountains',
  desert: 'Desert',
  gold:   'Gold',
};

const HEX_COLOR: Record<Resource, string> = {
  wood:   '#2d5a27',
  brick:  '#8b4513',
  sheep:  '#7ec850',
  wheat:  '#daa520',
  ore:    '#708090',
  desert: '#d2b48c',
  gold:   '#ffd700',
};

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [game, setGame] = useState<GameState>(createInitialGameState());
  const [buildingMode, setBuildingMode] = useState<'road' | 'settlement' | 'city' | null>(null);

  const currentPlayer = game.players[game.currentPlayer];
  const isSetup = game.phase === 'setup1' || game.phase === 'setup2';
  const isHumanTurn = currentPlayer?.isHuman;

  // ── AI auto-placement during setup ──────────────────────────────────────────
  useEffect(() => {
    if (!isSetup) return;
    if (isHumanTurn) return;

    const timeout = setTimeout(() => {
      if (game.setupStep === 'settlement') {
        const valid = getValidSettlementVertices(game);
        if (valid.length > 0) {
          const v = valid[Math.floor(Math.random() * valid.length)];
          doPlaceSettlement(game, v.id);
        }
      } else {
        const valid = getValidRoadEdgesSetup(game);
        if (valid.length > 0) {
          const e = valid[Math.floor(Math.random() * valid.length)];
          doPlaceRoad(game, e.id);
        }
      }
    }, 700);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.currentPlayer, game.phase, game.setupStep]);

  // ── Core placement logic (called by both human clicks and AI) ────────────────

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
          p.id !== player.id ? p
            : { ...p, pieces: { ...p.pieces, settlements: p.pieces.settlements - 1 } }
        ),
        setupStep: 'road',
        setupLastSettlementVertexId: vertexId,
      };

      // Give resources immediately after placing 2nd settlement (setup2)
      if (state.phase === 'setup2') {
        const resources = getAdjacentResources(state, vertexId);
        const resMap: Partial<Record<Resource, number>> = { ...newGame.players[player.id].resources };
        for (const r of resources) resMap[r] = (resMap[r] || 0) + 1;
        newGame.players = newGame.players.map(p =>
          p.id !== player.id ? p : { ...p, resources: resMap }
        );
        addLog(newGame, `${player.name} placed settlement & received: ${resources.join(', ') || 'nothing'}`);
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
            e.id !== edgeId ? e
              : { ...e, roads: { ...e.roads, [player.id]: 'road' as const } }
          ),
        },
        players: state.players.map(p =>
          p.id !== player.id ? p
            : { ...p, pieces: { ...p.pieces, roads: p.pieces.roads - 1 } }
        ),
      };

      if (state.phase === 'setup1' || state.phase === 'setup2') {
        advanceSetupState(newGame);
      } else {
        // Deduct resources in playing phase
        newGame.players = newGame.players.map(p =>
          p.id !== player.id ? p : {
            ...p,
            resources: {
              ...p.resources,
              wood: (p.resources.wood || 0) - 1,
              brick: (p.resources.brick || 0) - 1,
            },
            pieces: { ...p.pieces, roads: p.pieces.roads - 1 },
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
  const handlePlaceRoad = (edgeId: string) => doPlaceRoad(game, edgeId);

  const handlePlaceSettlementPlaying = (vertexId: string) => {
    const player = currentPlayer;
    if (!player) return;
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
              wood: (p.resources.wood || 0) - 1,
              brick: (p.resources.brick || 0) - 1,
              wheat: (p.resources.wheat || 0) - 1,
              sheep: (p.resources.sheep || 0) - 1,
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

  const handleRollDice = () => {
    const dice = rollDice();
    const sum = dice[0] + dice[1];
    setGame(prev => {
      const newGame = { ...prev, dice };
      distributeResources(newGame, sum);
      addLog(newGame, `Rolled ${dice[0]} + ${dice[1]} = ${sum}`);
      return newGame;
    });
  };

  const handleEndTurn = () => {
    setBuildingMode(null);
    setGame(prev => {
      const nextPlayer = (prev.currentPlayer + 1) % 4;
      return { ...prev, currentPlayer: nextPlayer, turn: prev.turn + 1, dice: null };
    });
  };

  const handleNewGame = () => {
    setBuildingMode(null);
    setGame(createInitialGameState());
  };

  const handleBuildToggle = (type: 'road' | 'settlement' | 'city') => {
    setBuildingMode(prev => prev === type ? null : type);
  };

  // ── Rendering ────────────────────────────────────────────────────────────────

  const getNumberColor = (num: number | null): string => {
    if (!num) return '#666';
    return num === 6 || num === 8 ? '#c0392b' : '#2c3e50';
  };

  const renderHex = (hex: Hex) => {
    const cx = HEX_SIZE * 1.5 * hex.q;
    const cy = HEX_SIZE * (Math.sqrt(3) / 2 * hex.q + Math.sqrt(3) * hex.r);

    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      pts.push(`${cx + HEX_SIZE * Math.cos(a)},${cy + HEX_SIZE * Math.sin(a)}`);
    }

    return (
      <g key={hex.id}>
        <polygon
          points={pts.join(' ')}
          fill={HEX_COLOR[hex.resource]}
          stroke="#5a3010"
          strokeWidth="3"
          className="hex"
        />
        {/* Resource icon */}
        <text x={cx} y={cy - (hex.number ? 22 : 8)} textAnchor="middle" fontSize="22" style={{ userSelect: 'none' }}>
          {HEX_ICON[hex.resource]}
        </text>
        {/* Resource label (small, under icon) */}
        <text x={cx} y={cy - (hex.number ? 6 : 10)} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.75)" fontWeight="bold" style={{ userSelect: 'none' }}>
          {HEX_LABEL[hex.resource].toUpperCase()}
        </text>
        {/* Number token */}
        {hex.number && (
          <>
            <circle cx={cx} cy={cy + 14} r={16} fill={hex.hasRobber ? '#333' : '#fff'} opacity={0.93} />
            <text
              x={cx} y={cy + 19}
              textAnchor="middle"
              fill={getNumberColor(hex.number)}
              fontSize="14"
              fontWeight="bold"
              style={{ userSelect: 'none' }}
            >
              {hex.number}
            </text>
          </>
        )}
        {hex.hasRobber && !hex.number && (
          <text x={cx} y={cy + 8} textAnchor="middle" fontSize="18" style={{ userSelect: 'none' }}>☠️</text>
        )}
      </g>
    );
  };

  const renderSettlements = () =>
    game.board.vertices.flatMap(vertex =>
      Object.entries(vertex.settlements)
        .filter(([, t]) => t)
        .map(([pid, type]) => {
          const p = game.players[parseInt(pid)];
          return (
            <circle
              key={`${vertex.id}-${pid}`}
              cx={vertex.x} cy={vertex.y}
              r={type === 'city' ? 14 : 10}
              fill={p.color} stroke="#000" strokeWidth="2"
            />
          );
        })
    );

  const renderRoads = () =>
    game.board.edges.flatMap(edge =>
      Object.entries(edge.roads)
        .filter(([, t]) => t)
        .map(([pid]) => {
          const p = game.players[parseInt(pid)];
          return (
            <line
              key={`${edge.id}-${pid}`}
              x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2}
              stroke={p.color} strokeWidth="8" strokeLinecap="round"
            />
          );
        })
    );

  const renderBuildableSpots = () => {
    // During setup: auto-show what must be placed (human turn only)
    if (isSetup && isHumanTurn) {
      if (game.setupStep === 'settlement') {
        return getValidSettlementVertices(game).map(v => (
          <circle
            key={`spot-${v.id}`}
            cx={v.x} cy={v.y} r={13}
            fill="rgba(255,255,255,0.25)" stroke="#27ae60" strokeWidth="3"
            style={{ cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); handlePlaceSettlement(v.id); }}
          />
        ));
      } else {
        return getValidRoadEdgesSetup(game).map(e => (
          <line
            key={`spot-${e.id}`}
            x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
            stroke="rgba(255,255,255,0.55)" strokeWidth="10" strokeLinecap="round"
            style={{ cursor: 'pointer' }}
            onClick={ev => { ev.stopPropagation(); handlePlaceRoad(e.id); }}
          />
        ));
      }
    }

    // Playing phase manual building mode
    if (!buildingMode || !isHumanTurn || isSetup) return null;

    if (buildingMode === 'settlement') {
      return getValidSettlementVertices(game).map(v => (
        <circle
          key={`spot-${v.id}`}
          cx={v.x} cy={v.y} r={13}
          fill="rgba(255,255,255,0.25)" stroke="#27ae60" strokeWidth="3"
          style={{ cursor: 'pointer' }}
          onClick={e => { e.stopPropagation(); handlePlaceSettlementPlaying(v.id); }}
        />
      ));
    }

    if (buildingMode === 'road') {
      return getValidRoadEdges(game).map(e => (
        <line
          key={`spot-${e.id}`}
          x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
          stroke="rgba(255,255,255,0.55)" strokeWidth="10" strokeLinecap="round"
          style={{ cursor: 'pointer' }}
          onClick={ev => { ev.stopPropagation(); handlePlaceRoad(e.id); }}
        />
      ));
    }

    return null;
  };

  const getDisplayVP = (player: typeof currentPlayer) => calculateVP(player, game);

  // ── Setup order indicator ─────────────────────────────────────────────────
  const setupOrder = game.phase === 'setup1'
    ? [0, 1, 2, 3]
    : game.phase === 'setup2'
    ? [3, 2, 1, 0]
    : [];

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
          <div
            key={player.id}
            className={`player-card ${player.id === game.currentPlayer ? 'active' : ''}`}
            style={{ borderColor: player.color }}
          >
            <div className="player-name" style={{ color: player.color }}>{player.name}</div>
            <div className="player-vp">VP: {getDisplayVP(player)}</div>
            <div className="player-resources">
              {Object.entries(player.resources)
                .filter(([, count]) => (count ?? 0) > 0)
                .map(([res, count]) => (
                  <span key={res} className="resource">
                    {HEX_ICON[res as Resource]} {count}
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>

      {/* Main Game Area */}
      <div className="game-area">
        <div className="board-container">
          <svg
            width="560" height="560"
            viewBox="-260 -270 520 540"
            className="board"
            onClick={() => buildingMode && setBuildingMode(null)}
          >
            {game.board.hexes.map(renderHex)}
            {renderRoads()}
            {renderSettlements()}
            {renderBuildableSpots()}
          </svg>
        </div>

        {/* Action Panel */}
        <div className="action-panel">
          {isSetup ? (
            /* ── Setup panel ── */
            <>
              <h3>🏗️ Setup Phase</h3>
              <div style={{ background: '#1a2a3a', borderRadius: '8px', padding: '12px', marginBottom: '15px' }}>
                <div style={{ marginBottom: '8px', fontSize: '0.9rem', color: '#aaa' }}>
                  {game.phase === 'setup1' ? 'Round 1 — Clockwise ➜' : 'Round 2 — Counter-clockwise ←'}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {setupOrder.map(pid => (
                    <span
                      key={pid}
                      style={{
                        padding: '4px 10px', borderRadius: '6px',
                        background: pid === game.currentPlayer ? game.players[pid].color : 'rgba(255,255,255,0.1)',
                        color: pid === game.currentPlayer ? '#000' : game.players[pid].color,
                        fontWeight: pid === game.currentPlayer ? 'bold' : 'normal',
                        border: `2px solid ${game.players[pid].color}`,
                        fontSize: '0.85rem',
                      }}
                    >
                      {game.players[pid].name}
                    </span>
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
            /* ── Playing panel ── */
            <>
              <h3>Actions</h3>

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

              {buildingMode && (
                <div style={{ padding: '10px', background: '#27ae60', borderRadius: '8px', marginBottom: '15px', textAlign: 'center' }}>
                  <strong>🏗️ Placing {buildingMode}!</strong>
                  <br /><small>Click a highlighted spot — or click the board to cancel</small>
                </div>
              )}

              <div className="build-section">
                <h4>Build</h4>
                <button className={`btn ${buildingMode === 'road' ? 'active' : ''}`} onClick={() => handleBuildToggle('road')} disabled={!isHumanTurn}>
                  🛣️ Road (1🌲+1🧱)
                </button>
                <button className={`btn ${buildingMode === 'settlement' ? 'active' : ''}`} onClick={() => handleBuildToggle('settlement')} disabled={!isHumanTurn}>
                  🏠 Settlement (1🌲+1🧱+1🌾+1🐑)
                </button>
                <button className={`btn ${buildingMode === 'city' ? 'active' : ''}`} onClick={() => handleBuildToggle('city')} disabled={!isHumanTurn}>
                  🏰 City (2🌾+3⛏️)
                </button>
              </div>

              <button className="btn btn-secondary" onClick={handleEndTurn} disabled={!isHumanTurn}>
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
    </div>
  );
}

export default App;
