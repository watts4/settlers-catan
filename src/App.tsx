import { useState } from 'react';
import type { GameState, Hex, Resource, Vertex, Edge } from './types';
import { createInitialGameState, rollDice, distributeResources, calculateVP, addLog } from './gameState';
import { HEX_SIZE } from './board';
import './App.css';

// ── Placement validity helpers ────────────────────────────────────────────────

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

function getValidSettlementVertices(game: GameState): Vertex[] {
  const playerId = game.currentPlayer.toString();
  return game.board.vertices.filter(v => {
    // Must be unoccupied
    if (Object.values(v.settlements).some(s => s)) return false;
    // Distance rule: no adjacent settled vertices
    for (const other of game.board.vertices) {
      if (!Object.values(other.settlements).some(s => s)) continue;
      if (distSq(v.x, v.y, other.x, other.y) < (HEX_SIZE * 1.1) ** 2) return false;
    }
    // In playing phase also require a connected road
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

function getValidRoadEdges(game: GameState): Edge[] {
  const playerId = game.currentPlayer.toString();
  return game.board.edges.filter(e => {
    // Must be unoccupied
    if (Object.values(e.roads).some(r => r)) return false;
    // Must connect to own settlement or own road
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

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [game, setGame] = useState<GameState>(createInitialGameState());
  const [buildingMode, setBuildingMode] = useState<'road' | 'settlement' | 'city' | null>(null);

  const currentPlayer = game.players[game.currentPlayer];
  const isHumanTurn = currentPlayer?.isHuman;

  // ── Actions ─────────────────────────────────────────────────────────────────

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
      return {
        ...prev,
        currentPlayer: nextPlayer,
        turn: nextPlayer === 0 ? prev.turn + 1 : prev.turn,
        dice: null,
      };
    });
  };

  const handleNewGame = () => {
    setBuildingMode(null);
    setGame(createInitialGameState());
  };

  const handleBuildToggle = (type: 'road' | 'settlement' | 'city') => {
    setBuildingMode(prev => prev === type ? null : type);
  };

  // ── Place settlement on a specific vertex ────────────────────────────────────

  const handlePlaceSettlement = (vertexId: string) => {
    const player = currentPlayer;
    if (!player) return;

    setGame(prev => {
      const newGame = { ...prev };
      newGame.board = { ...prev.board, vertices: prev.board.vertices.map(v => {
        if (v.id !== vertexId) return v;
        return { ...v, settlements: { ...v.settlements, [player.id]: 'settlement' } };
      })};

      // Deduct resources only in playing phase
      if (prev.phase === 'playing') {
        newGame.players = prev.players.map(p => p.id !== player.id ? p : {
          ...p,
          resources: {
            ...p.resources,
            wood: (p.resources.wood || 0) - 1,
            brick: (p.resources.brick || 0) - 1,
            wheat: (p.resources.wheat || 0) - 1,
            sheep: (p.resources.sheep || 0) - 1,
          },
          pieces: { ...p.pieces, settlements: p.pieces.settlements - 1 },
        });
      }

      addLog(newGame, `${player.name} built a settlement`);
      return newGame;
    });

    setBuildingMode(null);
  };

  // ── Place road on a specific edge ────────────────────────────────────────────

  const handlePlaceRoad = (edgeId: string) => {
    const player = currentPlayer;
    if (!player) return;

    setGame(prev => {
      const newGame = { ...prev };
      newGame.board = { ...prev.board, edges: prev.board.edges.map(e => {
        if (e.id !== edgeId) return e;
        return { ...e, roads: { ...e.roads, [player.id]: 'road' } };
      })};

      if (prev.phase === 'playing') {
        newGame.players = prev.players.map(p => p.id !== player.id ? p : {
          ...p,
          resources: {
            ...p.resources,
            wood: (p.resources.wood || 0) - 1,
            brick: (p.resources.brick || 0) - 1,
          },
          pieces: { ...p.pieces, roads: p.pieces.roads - 1 },
        });
      }

      addLog(newGame, `${player.name} built a road`);
      return newGame;
    });

    setBuildingMode(null);
  };

  // ── Rendering helpers ────────────────────────────────────────────────────────

  const getHexColor = (resource: Resource): string => {
    const colors: Record<Resource, string> = {
      wood: '#2d5a27',
      brick: '#8b4513',
      sheep: '#7ec850',
      wheat: '#daa520',
      ore: '#708090',
      desert: '#d2b48c',
      gold: '#ffd700',
    };
    return colors[resource];
  };

  const getNumberColor = (num: number | null): string => {
    if (!num) return '#666';
    return num === 6 || num === 8 ? '#c0392b' : '#2c3e50';
  };

  // ── Render hex tile ──────────────────────────────────────────────────────────

  const renderHex = (hex: Hex) => {
    const cx = HEX_SIZE * 1.5 * hex.q;
    const cy = HEX_SIZE * (Math.sqrt(3) / 2 * hex.q + Math.sqrt(3) * hex.r);

    const points: string[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      points.push(`${cx + HEX_SIZE * Math.cos(angle)},${cy + HEX_SIZE * Math.sin(angle)}`);
    }

    return (
      <g key={hex.id}>
        <polygon
          points={points.join(' ')}
          fill={getHexColor(hex.resource)}
          stroke="#5a3010"
          strokeWidth="3"
          className="hex"
        />
        {hex.number && (
          <circle cx={cx} cy={cy} r={18} fill={hex.hasRobber ? '#333' : '#fff'} />
        )}
        {hex.number && (
          <text
            x={cx} y={cy + 5}
            textAnchor="middle"
            fill={getNumberColor(hex.number)}
            fontSize="15"
            fontWeight="bold"
          >
            {hex.number}
          </text>
        )}
        {hex.hasRobber && (
          <text x={cx} y={cy - 26} textAnchor="middle" fontSize="20">☠️</text>
        )}
      </g>
    );
  };

  // ── Render placed settlements / cities ───────────────────────────────────────

  const renderSettlements = () => {
    return game.board.vertices.flatMap(vertex =>
      Object.entries(vertex.settlements)
        .filter(([, type]) => type)
        .map(([playerId, type]) => {
          const player = game.players[parseInt(playerId)];
          return (
            <circle
              key={`${vertex.id}-${playerId}`}
              cx={vertex.x}
              cy={vertex.y}
              r={type === 'city' ? 14 : 10}
              fill={player.color}
              stroke="#000"
              strokeWidth="2"
            />
          );
        })
    );
  };

  // ── Render placed roads ──────────────────────────────────────────────────────

  const renderRoads = () => {
    return game.board.edges.flatMap(edge =>
      Object.entries(edge.roads)
        .filter(([, type]) => type)
        .map(([playerId]) => {
          const player = game.players[parseInt(playerId)];
          return (
            <line
              key={`${edge.id}-${playerId}`}
              x1={edge.x1} y1={edge.y1}
              x2={edge.x2} y2={edge.y2}
              stroke={player.color}
              strokeWidth="8"
              strokeLinecap="round"
            />
          );
        })
    );
  };

  // ── Render interactive placement spots ───────────────────────────────────────

  const renderBuildableSpots = () => {
    if (!buildingMode || !isHumanTurn) return null;

    if (buildingMode === 'settlement') {
      const valid = getValidSettlementVertices(game);
      return valid.map(v => (
        <circle
          key={`spot-${v.id}`}
          cx={v.x} cy={v.y}
          r={13}
          fill="rgba(255,255,255,0.25)"
          stroke="#27ae60"
          strokeWidth="3"
          style={{ cursor: 'pointer' }}
          onClick={e => { e.stopPropagation(); handlePlaceSettlement(v.id); }}
        />
      ));
    }

    if (buildingMode === 'road') {
      const valid = getValidRoadEdges(game);
      return valid.map(e => (
        <line
          key={`spot-${e.id}`}
          x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
          stroke="rgba(255,255,255,0.55)"
          strokeWidth="10"
          strokeLinecap="round"
          style={{ cursor: 'pointer' }}
          onClick={evt => { evt.stopPropagation(); handlePlaceRoad(e.id); }}
        />
      ));
    }

    return null;
  };

  const getDisplayVP = (player: typeof currentPlayer) => calculateVP(player, game);

  // ── JSX ──────────────────────────────────────────────────────────────────────

  return (
    <div className="game">
      {/* Header */}
      <header className="header">
        <h1>🎲 Settlers of Catan</h1>
        <button className="btn btn-secondary" onClick={handleNewGame} style={{ maxWidth: '120px', margin: '10px auto 0' }}>
          New Game
        </button>
        <div className="turn-info">
          Turn {game.turn} | {currentPlayer?.name}'s Turn
          {game.phase !== 'playing' && <span style={{ color: '#ffd700' }}> ({game.phase})</span>}
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
                  <span key={res} className="resource">{res[0].toUpperCase()}: {count}</span>
                ))}
            </div>
          </div>
        ))}
      </div>

      {/* Main Game Area */}
      <div className="game-area">
        {/* Board — viewBox covers the full hex grid centered at (0,0) */}
        <div className="board-container">
          <svg
            width="560"
            height="560"
            viewBox="-260 -270 520 540"
            className="board"
            onClick={() => buildingMode && setBuildingMode(null)}
          >
            {/* Hexes */}
            {game.board.hexes.map(renderHex)}
            {/* Placed roads */}
            {renderRoads()}
            {/* Placed settlements / cities */}
            {renderSettlements()}
            {/* Interactive placement spots (on top) */}
            {renderBuildableSpots()}
          </svg>
        </div>

        {/* Action Panel */}
        <div className="action-panel">
          <h3>Actions</h3>

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

          {/* Building mode indicator */}
          {buildingMode && (
            <div style={{ padding: '10px', background: '#27ae60', borderRadius: '8px', marginBottom: '15px', textAlign: 'center' }}>
              <strong>🏗️ Placing {buildingMode}!</strong>
              <br /><small>Click a highlighted spot on the board</small>
              <br /><small style={{ opacity: 0.8 }}>(click elsewhere to cancel)</small>
            </div>
          )}

          {/* Build buttons */}
          <div className="build-section">
            <h4>Build</h4>
            <button
              className={`btn ${buildingMode === 'road' ? 'active' : ''}`}
              onClick={() => handleBuildToggle('road')}
              disabled={!isHumanTurn}
            >
              🛣️ Road
            </button>
            <button
              className={`btn ${buildingMode === 'settlement' ? 'active' : ''}`}
              onClick={() => handleBuildToggle('settlement')}
              disabled={!isHumanTurn}
            >
              🏠 Settlement
            </button>
            <button
              className={`btn ${buildingMode === 'city' ? 'active' : ''}`}
              onClick={() => handleBuildToggle('city')}
              disabled={!isHumanTurn}
            >
              🏰 City
            </button>
          </div>

          {/* End Turn */}
          <button className="btn btn-secondary" onClick={handleEndTurn} disabled={!isHumanTurn}>
            ⏭️ End Turn
          </button>

          {/* Cost Reference */}
          <div className="costs">
            <h4>Costs</h4>
            <div>Road: 1 🪵 + 1 🧱</div>
            <div>Settlement: 1 🪵 + 1 🧱 + 1 🌾 + 1 🐑</div>
            <div>City: 2 🌾 + 3 ⛏️</div>
          </div>
        </div>
      </div>

      {/* Game Log */}
      <div className="game-log">
        <h4>📜 Game Log</h4>
        <div className="log-entries">
          {game.log.slice(-10).map((entry, i) => (
            <div key={i} className="log-entry">
              <span className="log-turn">T{entry.turn}</span>
              <span className="log-player" style={{ color: game.players[entry.player].color }}>
                {game.players[entry.player].name}
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
