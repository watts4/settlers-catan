import { useState } from 'react';
import { doc, runTransaction } from 'firebase/firestore';
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

// Rustic outback theme colors — matches LandingPage
const COLORS = {
  bg: '#1a1008',
  bgLight: '#2a1a0e',
  cardBg: 'rgba(60, 40, 20, 0.7)',
  cardBorder: '#6b4a18',
  gold: '#d4a020',
  goldBright: '#ffd700',
  cream: '#f0e0c8',
  parchment: '#d2b48c',
  muted: '#9a8a6a',
  green: '#4a7a30',
  greenBright: '#5d9b3a',
  red: '#8b2020',
  wood: '#6b3410',
  woodLight: '#8b5e2f',
  woodDark: '#3a1a08',
};

const btnBase: React.CSSProperties = {
  border: 'none',
  cursor: 'pointer',
  fontFamily: "'Georgia', 'Palatino', serif",
  transition: 'all 0.2s ease',
  letterSpacing: '0.03em',
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
  const [markingAI, setMarkingAI] = useState<number | null>(null);

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
    if (markingAI !== null) return; // prevent rapid double-clicks
    setMarkingAI(slot);
    try {
      const roomRef = doc(db, 'games', roomId);
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(roomRef);
        if (!snap.exists()) return;
        const data = snap.data() as GameRoomData;

        const existing = data.players.find((p) => p.slot === slot);
        const aiPlayer: GameRoomPlayer = {
          slot,
          name: `AI Player ${slot + 1}`,
          sessionId: `ai-${slot}`,
          isHuman: false,
          joinedAt: Date.now(),
          uid: undefined,
        };

        const updatedPlayers = existing
          ? data.players.map((p) =>
              p.slot === slot
                ? { ...p, isHuman: false, name: `AI Player ${slot + 1}` }
                : p
            )
          : [...data.players, aiPlayer];

        transaction.update(roomRef, {
          players: updatedPlayers,
          updatedAt: Date.now(),
        });
      });
    } finally {
      setMarkingAI(null);
    }
  }

  const humanCount = roomData.players.filter((p) => p.isHuman).length;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: `
          radial-gradient(ellipse at 30% 20%, rgba(107, 52, 16, 0.3) 0%, transparent 60%),
          radial-gradient(ellipse at 70% 80%, rgba(139, 94, 47, 0.2) 0%, transparent 50%),
          linear-gradient(180deg, ${COLORS.bg} 0%, ${COLORS.bgLight} 40%, ${COLORS.bg} 100%)
        `,
        color: COLORS.cream,
        fontFamily: "'Georgia', 'Palatino', serif",
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
            fontWeight: 700,
            color: COLORS.goldBright,
            margin: '0 0 6px',
            letterSpacing: '1px',
            textShadow: `0 2px 12px rgba(212, 160, 32, 0.4), 0 0 40px rgba(212, 160, 32, 0.15)`,
            fontFamily: "'Georgia', 'Palatino', serif",
          }}
        >
          Game Lobby
        </h1>
        <div
          style={{
            width: '80px',
            height: '2px',
            background: `linear-gradient(90deg, transparent, ${COLORS.gold}, transparent)`,
            margin: '8px auto 10px',
          }}
        />
        <p style={{ color: COLORS.parchment, margin: 0, fontSize: '14px', fontStyle: 'italic', opacity: 0.8 }}>
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
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 16px rgba(0,0,0,0.4)`,
        }}
      >
        <div style={{ color: COLORS.muted, fontSize: '13px', marginBottom: '6px', letterSpacing: '2px', textTransform: 'uppercase' }}>
          Room Code
        </div>
        <div
          style={{
            fontSize: '42px',
            fontWeight: 900,
            letterSpacing: '8px',
            color: COLORS.goldBright,
            fontVariantNumeric: 'tabular-nums',
            marginBottom: '20px',
            textShadow: `0 2px 12px rgba(212, 160, 32, 0.4)`,
          }}
        >
          {roomId}
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={copyInviteLink}
            style={{
              ...btnBase,
              background: copied === 'link'
                ? `linear-gradient(180deg, ${COLORS.greenBright}, ${COLORS.green})`
                : `linear-gradient(180deg, ${COLORS.woodLight}, ${COLORS.wood})`,
              border: `1px solid ${copied === 'link' ? COLORS.greenBright : COLORS.cardBorder}`,
              color: COLORS.cream,
              padding: '9px 18px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
              textShadow: '0 1px 2px rgba(0,0,0,0.4)',
            }}
          >
            {copied === 'link' ? 'Copied!' : 'Copy Invite Link'}
          </button>
          <button
            onClick={copyRoomCode}
            style={{
              ...btnBase,
              background: copied === 'code'
                ? `linear-gradient(180deg, ${COLORS.greenBright}, ${COLORS.green})`
                : `linear-gradient(180deg, ${COLORS.woodLight}, ${COLORS.wood})`,
              border: `1px solid ${copied === 'code' ? COLORS.greenBright : COLORS.cardBorder}`,
              color: COLORS.cream,
              padding: '9px 18px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
              textShadow: '0 1px 2px rgba(0,0,0,0.4)',
            }}
          >
            {copied === 'code' ? 'Copied!' : 'Copy Code'}
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
        <div style={{ color: COLORS.muted, fontSize: '13px', marginBottom: '4px', letterSpacing: '2px', textTransform: 'uppercase' }}>
          Players ({humanCount} / 4)
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
                  ? `linear-gradient(135deg, rgba(107, 52, 16, 0.5), rgba(60, 40, 20, 0.7))`
                  : COLORS.cardBg,
                border: `1px solid ${isMe ? COLORS.gold + '88' : COLORS.cardBorder}`,
                borderRadius: '12px',
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                boxShadow: isMe ? `0 0 12px rgba(212, 160, 32, 0.15)` : 'none',
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
                  <span style={{ fontWeight: 600, flex: 1, color: COLORS.cream }}>
                    {isAI ? '🤖 ' : ''}{player!.name}
                    {isMe && (
                      <span
                        style={{
                          marginLeft: '8px',
                          background: COLORS.gold,
                          color: '#1a1008',
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
                          background: COLORS.woodDark,
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
                        background: COLORS.greenBright,
                        flexShrink: 0,
                        boxShadow: `0 0 6px ${COLORS.greenBright}`,
                      }}
                    />
                  )}
                </>
              ) : (
                <>
                  <span style={{ color: COLORS.muted, flex: 1, fontSize: '14px', fontStyle: 'italic' }}>
                    Empty slot — waiting...
                  </span>
                  {isHost && (
                    <button
                      onClick={() => markSlotAsAI(slot)}
                      disabled={markingAI !== null}
                      style={{
                        ...btnBase,
                        background: 'transparent',
                        border: `1px solid ${COLORS.cardBorder}`,
                        color: COLORS.muted,
                        padding: '5px 12px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        whiteSpace: 'nowrap',
                        opacity: markingAI !== null ? 0.5 : 1,
                        cursor: markingAI !== null ? 'not-allowed' : 'pointer',
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
              ...btnBase,
              flex: 1,
              background: `linear-gradient(180deg, ${COLORS.greenBright}, ${COLORS.green})`,
              border: `2px solid ${COLORS.greenBright}`,
              color: '#fff',
              padding: '14px',
              borderRadius: '12px',
              fontSize: '16px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.15), 0 3px 10px rgba(0,0,0,0.3)`,
              textShadow: '0 1px 2px rgba(0,0,0,0.3)',
            }}
          >
            Start Game
          </button>
        )}

        <button
          onClick={onLeave}
          style={{
            ...btnBase,
            flex: isHost ? '0 0 auto' : 1,
            background: 'transparent',
            border: `2px solid ${COLORS.cardBorder}`,
            color: COLORS.muted,
            padding: '14px 20px',
            borderRadius: '12px',
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
          fontStyle: 'italic',
          letterSpacing: '0.5px',
        }}
      >
        Share the room code or invite link with your friends!
      </p>
    </div>
  );
}
