import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { GameRoomData, GameRoomPlayer } from './useGameRoom';

interface GameLobbyProps {
  roomId: string;
  mySlot: number;
  isHost: boolean;
  roomData: GameRoomData;
  onStartGame: () => void;
  onLeave: () => void;
}

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#ecf0f1', '#e67e22'];
const PLAYER_LABELS = ['Red', 'Blue', 'White', 'Orange'];

const COLORS = {
  bg: '#0d1117',
  cardBg: '#1a2a3a',
  cardBorder: '#2a4a6a',
  gold: '#ffd700',
  goldDim: '#c9a800',
  white: '#f0f0f0',
  muted: '#8899aa',
  green: '#2ecc71',
  red: '#e74c3c',
};

export default function GameLobby({
  roomId,
  mySlot,
  isHost,
  roomData,
  onStartGame,
  onLeave,
}: GameLobbyProps) {
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);

  function getPlayerInSlot(slot: number): GameRoomPlayer | undefined {
    return roomData.players.find((p) => p.slot === slot);
  }

  async function copyInviteLink() {
    const link =
      window.location.origin + window.location.pathname + '?room=' + roomId;
    try {
      await navigator.clipboard.writeText(link);
      setCopied('link');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // fallback: select from a temp input
      const el = document.createElement('input');
      el.value = link;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied('link');
      setTimeout(() => setCopied(null), 2000);
    }
  }

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied('code');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied('code');
      setTimeout(() => setCopied(null), 2000);
    }
  }

  async function markSlotAsAI(slot: number) {
    const existing = getPlayerInSlot(slot);
    const aiPlayer: GameRoomPlayer = {
      slot,
      name: `AI Player ${slot + 1}`,
      sessionId: `ai-${slot}`,
      isHuman: false,
      joinedAt: Date.now(),
      uid: undefined,
    };

    const updatedPlayers = existing
      ? roomData.players.map((p) => (p.slot === slot ? { ...p, isHuman: false, name: `AI Player ${slot + 1}` } : p))
      : [...roomData.players, aiPlayer];

    await updateDoc(doc(db, 'games', roomId), {
      players: updatedPlayers,
      updatedAt: Date.now(),
    });
  }

  const humanCount = roomData.players.filter((p) => p.isHuman).length;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: `linear-gradient(135deg, ${COLORS.bg} 0%, #0a1929 50%, #0d1117 100%)`,
        color: COLORS.white,
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '32px 16px',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <h1
          style={{
            fontSize: '36px',
            fontWeight: 800,
            color: COLORS.gold,
            margin: '0 0 4px',
            textShadow: `0 0 20px ${COLORS.goldDim}66`,
          }}
        >
          🏰 Game Lobby
        </h1>
        <p style={{ color: COLORS.muted, margin: 0, fontSize: '14px' }}>
          Waiting for players to join...
        </p>
      </div>

      {/* Room code card */}
      <div
        style={{
          background: COLORS.cardBg,
          border: `2px solid ${COLORS.gold}55`,
          borderRadius: '16px',
          padding: '24px 32px',
          marginBottom: '24px',
          textAlign: 'center',
          width: '100%',
          maxWidth: '480px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ color: COLORS.muted, fontSize: '13px', marginBottom: '6px' }}>
          ROOM CODE
        </div>
        <div
          style={{
            fontSize: '42px',
            fontWeight: 900,
            letterSpacing: '8px',
            color: COLORS.gold,
            fontVariantNumeric: 'tabular-nums',
            marginBottom: '20px',
          }}
        >
          {roomId}
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={copyInviteLink}
            style={{
              background: copied === 'link' ? COLORS.green : '#1e3a5a',
              border: `1px solid ${copied === 'link' ? COLORS.green : COLORS.cardBorder}`,
              color: COLORS.white,
              padding: '9px 18px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s',
            }}
          >
            📋 {copied === 'link' ? 'Copied!' : 'Copy Invite Link'}
          </button>
          <button
            onClick={copyRoomCode}
            style={{
              background: copied === 'code' ? COLORS.green : '#1e3a5a',
              border: `1px solid ${copied === 'code' ? COLORS.green : COLORS.cardBorder}`,
              color: COLORS.white,
              padding: '9px 18px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s',
            }}
          >
            🔑 {copied === 'code' ? 'Copied!' : 'Copy Code'}
          </button>
        </div>
      </div>

      {/* Player slots */}
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          marginBottom: '24px',
        }}
      >
        <div style={{ color: COLORS.muted, fontSize: '13px', marginBottom: '4px' }}>
          PLAYERS ({humanCount} / 4)
        </div>

        {[0, 1, 2, 3].map((slot) => {
          const player = getPlayerInSlot(slot);
          const isMe = slot === mySlot;
          const isOccupied = !!player;
          const isAI = player && !player.isHuman;

          return (
            <div
              key={slot}
              style={{
                background: isMe
                  ? `linear-gradient(135deg, #1a2a3a, #1a3050)`
                  : COLORS.cardBg,
                border: `1px solid ${isMe ? COLORS.gold + '88' : COLORS.cardBorder}`,
                borderRadius: '12px',
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
              }}
            >
              {/* Color dot */}
              <div
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  background: PLAYER_COLORS[slot],
                  flexShrink: 0,
                  boxShadow: `0 0 6px ${PLAYER_COLORS[slot]}88`,
                }}
              />

              {/* Slot label */}
              <span style={{ color: COLORS.muted, fontSize: '12px', width: '42px', flexShrink: 0 }}>
                {PLAYER_LABELS[slot]}
              </span>

              {/* Player info */}
              {isOccupied ? (
                <>
                  <span style={{ fontWeight: 600, flex: 1 }}>
                    {isAI ? '🤖 ' : ''}{player!.name}
                    {isMe && (
                      <span
                        style={{
                          marginLeft: '8px',
                          background: COLORS.gold,
                          color: '#000',
                          fontSize: '10px',
                          padding: '2px 7px',
                          borderRadius: '4px',
                          fontWeight: 700,
                        }}
                      >
                        YOU
                      </span>
                    )}
                    {slot === 0 && (
                      <span
                        style={{
                          marginLeft: '8px',
                          background: '#3a2a0a',
                          color: COLORS.gold,
                          fontSize: '10px',
                          padding: '2px 7px',
                          borderRadius: '4px',
                          fontWeight: 700,
                          border: `1px solid ${COLORS.gold}44`,
                        }}
                      >
                        HOST
                      </span>
                    )}
                  </span>
                  {isAI && (
                    <span style={{ color: COLORS.muted, fontSize: '12px' }}>AI</span>
                  )}
                  {!isAI && !isMe && (
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: COLORS.green,
                        flexShrink: 0,
                        boxShadow: `0 0 6px ${COLORS.green}`,
                      }}
                    />
                  )}
                </>
              ) : (
                <>
                  <span style={{ color: COLORS.muted, flex: 1, fontSize: '14px' }}>
                    Empty slot — waiting...
                  </span>
                  {isHost && (
                    <button
                      onClick={() => markSlotAsAI(slot)}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${COLORS.cardBorder}`,
                        color: COLORS.muted,
                        padding: '5px 12px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      🤖 Mark as AI
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          display: 'flex',
          gap: '12px',
        }}
      >
        {isHost && (
          <button
            onClick={onStartGame}
            style={{
              flex: 1,
              background: `linear-gradient(135deg, #1a4a2a, #0f3a1a)`,
              border: `2px solid ${COLORS.green}`,
              color: COLORS.white,
              padding: '14px',
              borderRadius: '12px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            🎲 Start Game
          </button>
        )}

        <button
          onClick={onLeave}
          style={{
            flex: isHost ? '0 0 auto' : 1,
            background: 'transparent',
            border: `2px solid ${COLORS.cardBorder}`,
            color: COLORS.muted,
            padding: '14px 20px',
            borderRadius: '12px',
            cursor: 'pointer',
            fontSize: '15px',
            fontWeight: 600,
          }}
        >
          Leave
        </button>
      </div>

      {/* Footer */}
      <p
        style={{
          color: COLORS.muted,
          fontSize: '12px',
          marginTop: '32px',
          textAlign: 'center',
        }}
      >
        Share the room code or invite link with your friends!
      </p>
    </div>
  );
}
