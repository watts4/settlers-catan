import { useState } from 'react';
import type { GameState, Hex, Resource } from './types';
import { createInitialGameState, rollDice, distributeResources, calculateVP, addLog } from './gameState';
import './App.css';

function App() {
  const [game, setGame] = useState<GameState>(createInitialGameState());
  const [_selectedHex, setSelectedHex] = useState<Hex | null>(null);
  const [buildingMode, setBuildingMode] = useState<'road' | 'settlement' | 'city' | null>(null);

  // Get current player
  const currentPlayer = game.players[game.currentPlayer];
  const isHumanTurn = currentPlayer?.isHuman;

  // Roll dice
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

  // End turn
  const handleEndTurn = () => {
    setGame(prev => {
      const nextPlayer = (prev.currentPlayer + 1) % 4;
      // After human ends turn, AI plays
      if (nextPlayer !== 0) {
        // Let AI play (simplified - just move to next player)
        const newGame = {
          ...prev,
          currentPlayer: nextPlayer,
          turn: nextPlayer === 0 ? prev.turn + 1 : prev.turn,
        };
        return newGame;
      }
      
      return {
        ...prev,
        currentPlayer: nextPlayer,
        turn: prev.turn + 1,
        dice: null,
      };
    });
  };

  // New game
  const handleNewGame = () => {
    setGame(createInitialGameState());
  };

  // Build action
  const handleBuild = (type: 'road' | 'settlement' | 'city') => {
    setBuildingMode(type);
  };

  // Get hex color based on resource
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

  // Get dice number color
  const getNumberColor = (num: number | null): string => {
    if (!num) return '#666';
    return (num === 6 || num === 8) ? '#c0392b' : '#2c3e50';
  };

  // Render hex
  const renderHex = (hex: Hex) => {
    const size = 80;
    const x = size * (3/2 * hex.q);
    const y = size * (Math.sqrt(3)/2 * hex.q + Math.sqrt(3) * hex.r);
    
    // Hex points
    const points = [];
    for (let i = 0; i < 6; i++) {
      const angle = 2 * Math.PI / 6 * i;
      points.push(`${size * Math.cos(angle)},${size * Math.sin(angle)}`);
    }
    
    return (
      <g key={hex.id} transform={`translate(${200 + x}, ${150 + y})`}>
        <polygon
          points={points.join(' ')}
          fill={getHexColor(hex.resource)}
          stroke="#8b4513"
          strokeWidth="3"
          className="hex"
          onClick={() => setSelectedHex(hex)}
        />
        {hex.number && (
          <circle cx="0" cy="0" r="18" fill={hex.hasRobber ? '#333' : '#fff'} />
        )}
        {hex.number && (
          <text
            x="0"
            y="5"
            textAnchor="middle"
            fill={getNumberColor(hex.number)}
            fontSize="16"
            fontWeight="bold"
          >
            {hex.number}
          </text>
        )}
        {hex.hasRobber && (
          <text x="0" y="-25" textAnchor="middle" fontSize="20">☠️</text>
        )}
      </g>
    );
  };

  // Render vertices (settlements)
  const renderVertices = () => {
    return game.board.vertices.map(vertex => {
      const x = 80 * (3/2 * vertex.q);
      const y = 80 * (Math.sqrt(3)/2 * vertex.q + Math.sqrt(3) * vertex.r);
      
      // Calculate actual position
      const angle = (vertex.location * 60 - 30) * Math.PI / 180;
      const px = 200 + x + 70 * Math.cos(angle);
      const py = 150 + y + 50 * Math.sin(angle);
      
      // Check for settlements/cities
      const pieces = Object.entries(vertex.settlements)
        .filter(([, type]) => type);
      
      return pieces.map(([playerId, type]) => {
        const player = game.players[parseInt(playerId)];
        return (
          <circle
            key={`${vertex.id}-${playerId}`}
            cx={px}
            cy={py}
            r={type === 'city' ? 14 : 10}
            fill={player.color}
            stroke="#000"
            strokeWidth="2"
          />
        );
      });
    });
  };

  // Render edges (roads)
  const renderEdges = () => {
    return game.board.edges.map(edge => {
      const x = 80 * (3/2 * edge.q);
      const y = 80 * (Math.sqrt(3)/2 * edge.q + Math.sqrt(3) * edge.r);
      
      // Edge midpoint
      const angle = (edge.location * 60) * Math.PI / 180;
      const px = 200 + x + 60 * Math.cos(angle);
      const py = 150 + y + 60 * Math.sin(angle);
      
      const roads = Object.entries(edge.roads)
        .filter(([, type]) => type);
      
      return roads.map(([playerId]) => {
        const player = game.players[parseInt(playerId)];
        return (
          <line
            key={`${edge.id}-${playerId}`}
            x1={px - 8}
            y1={py - 8}
            x2={px + 8}
            y2={py + 8}
            stroke={player.color}
            strokeWidth="6"
            strokeLinecap="round"
          />
        );
      });
    });
  };

  // Calculate VP for display
  const getDisplayVP = (player: typeof currentPlayer) => {
    return calculateVP(player, game);
  };

  return (
    <div className="game">
      {/* Header */}
      <header className="header">
        <h1>🎲 Settlers of Catan</h1>
        <button className="btn btn-secondary" onClick={handleNewGame} style={{maxWidth: '120px', margin: '10px auto 0'}}>
          New Game
        </button>
        <div className="turn-info">
          Turn {game.turn} | {currentPlayer?.name}'s Turn
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
            <div className="player-name" style={{ color: player.color }}>
              {player.name}
            </div>
            <div className="player-vp">VP: {getDisplayVP(player)}</div>
            <div className="player-resources">
              {Object.entries(player.resources)
                .filter(([, count]) => count! > 0)
                .map(([res, count]) => (
                  <span key={res} className="resource">
                    {res[0].toUpperCase()}: {count}
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>

      {/* Main Game Area */}
      <div className="game-area">
        {/* Board */}
        <div className="board-container">
          <svg width="600" height="450" className="board">
            {game.board.hexes.map(renderHex)}
            {renderEdges()}
            {renderVertices()}
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
              <button
                className="btn btn-primary"
                onClick={handleRollDice}
                disabled={!isHumanTurn}
              >
                🎲 Roll Dice
              </button>
            )}
          </div>

          {/* Build buttons */}
          <div className="build-section">
            <h4>Build</h4>
            <button
              className={`btn ${buildingMode === 'road' ? 'active' : ''}`}
              onClick={() => handleBuild('road')}
              disabled={!isHumanTurn}
            >
              🛣️ Road
            </button>
            <button
              className={`btn ${buildingMode === 'settlement' ? 'active' : ''}`}
              onClick={() => handleBuild('settlement')}
              disabled={!isHumanTurn}
            >
              🏠 Settlement
            </button>
            <button
              className={`btn ${buildingMode === 'city' ? 'active' : ''}`}
              onClick={() => handleBuild('city')}
              disabled={!isHumanTurn}
            >
              🏰 City
            </button>
          </div>

          {/* End Turn */}
          <button
            className="btn btn-secondary"
            onClick={handleEndTurn}
            disabled={!isHumanTurn}
          >
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
