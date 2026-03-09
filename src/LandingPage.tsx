import { useState, useEffect } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { auth } from './firebase';

function useIsMobile(breakpoint = 768) {
  const query = `(max-width: ${breakpoint}px)`;
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return mobile;
}

interface LandingPageProps {
  onPlaySolo: () => void;
  onResumeSolo: () => void;
  onDiscardSolo: () => void;
  hasSoloSave: boolean;
  onCreateMultiplayer: (playerName: string) => void;
  onJoinMultiplayer: (roomCode: string, playerName: string) => void;
  savedGame: { roomId: string; slot: number } | null;
  onRejoinGame: (roomId: string, slot: number) => void;
  initialRoomCode?: string | null;
}

const COLORS = {
  bg: '#0d1117',
  cardBg: '#1a2a3a',
  cardBorder: '#2a4a6a',
  gold: '#ffd700',
  goldDim: '#c9a800',
  white: '#f0f0f0',
  muted: '#8899aa',
  red: '#e74c3c',
  blue: '#3498db',
  green: '#2ecc71',
  orange: '#e67e22',
};

export default function LandingPage({
  onPlaySolo,
  onResumeSolo,
  onDiscardSolo,
  hasSoloSave,
  onCreateMultiplayer,
  onJoinMultiplayer,
  savedGame,
  onRejoinGame,
  initialRoomCode,
}: LandingPageProps) {
  const isMobile = useIsMobile();
  const [user, setUser] = useState<User | null>(null);
  const [playerName, setPlayerName] = useState<string>('You');
  const [joinCode, setJoinCode] = useState<string>('');
  const [showJoin, setShowJoin] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [joinError, setJoinError] = useState<string>('');

  // Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u?.displayName) {
        setPlayerName(u.displayName);
      }
    });
    return unsub;
  }, []);

  // Parse ?room= from URL or initialRoomCode prop
  useEffect(() => {
    const code = initialRoomCode ?? new URLSearchParams(window.location.search).get('room');
    if (code) {
      setJoinCode(code.toUpperCase());
      setShowJoin(true);
    }
  }, [initialRoomCode]);

  async function handleSignIn() {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      if (result.user.displayName) {
        setPlayerName(result.user.displayName);
      }
    } catch (err) {
      console.error('Sign-in failed:', err);
    }
  }

  async function handleSignOut() {
    try {
      await signOut(auth);
      setPlayerName('You');
    } catch (err) {
      console.error('Sign-out failed:', err);
    }
  }

  async function handleCreate() {
    if (!playerName.trim()) return;
    setIsCreating(true);
    try {
      await onCreateMultiplayer(playerName.trim());
    } finally {
      setIsCreating(false);
    }
  }

  function handleJoin() {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      setJoinError('Room code must be 6 characters.');
      return;
    }
    setJoinError('');
    onJoinMultiplayer(code, playerName.trim() || 'You');
  }

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
        padding: isMobile ? '12px 10px' : '24px 16px',
        boxSizing: 'border-box',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          width: '100%',
          maxWidth: isMobile ? 'none' : '680px',
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: isMobile ? '8px' : '16px',
        }}
      >
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ color: COLORS.muted, fontSize: '14px' }}>
              {user.displayName ?? user.email}
            </span>
            <button
              onClick={handleSignOut}
              style={{
                background: 'transparent',
                border: `1px solid ${COLORS.cardBorder}`,
                color: COLORS.muted,
                padding: '6px 14px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Sign Out
            </button>
          </div>
        ) : (
          <button
            onClick={handleSignIn}
            style={{
              background: COLORS.cardBg,
              border: `1px solid ${COLORS.cardBorder}`,
              color: COLORS.white,
              padding: '8px 16px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
              <path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 6.293C4.672 4.166 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </button>
        )}
      </div>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: isMobile ? '16px' : '40px' }}>
        <div style={{ fontSize: isMobile ? '32px' : '56px', marginBottom: '4px' }}>🎲</div>
        <h1
          style={{
            fontSize: isMobile ? '24px' : 'clamp(28px, 6vw, 48px)',
            fontWeight: 800,
            color: COLORS.gold,
            margin: '0 0 4px',
            letterSpacing: '-1px',
            textShadow: `0 0 30px ${COLORS.goldDim}88`,
          }}
        >
          Settlers of Catan
        </h1>
        <p style={{ color: COLORS.muted, margin: 0, fontSize: isMobile ? '13px' : '16px' }}>
          Build, trade, and conquer the island
        </p>
      </div>

      {/* Rejoin banner */}
      {savedGame && (
        <div
          style={{
            width: '100%',
            maxWidth: isMobile ? 'none' : '680px',
            background: 'linear-gradient(135deg, #1a3a2a, #0d2a1a)',
            border: `1px solid ${COLORS.green}44`,
            borderRadius: '12px',
            padding: '14px 20px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ color: COLORS.green, fontWeight: 600 }}>
            🔁 You have an active multiplayer game
          </span>
          <button
            onClick={() => onRejoinGame(savedGame.roomId, savedGame.slot)}
            style={{
              background: COLORS.green,
              color: '#000',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 20px',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Rejoin Game
          </button>
        </div>
      )}

      {/* Name input */}
      <div
        style={{
          width: '100%',
          maxWidth: isMobile ? 'none' : '680px',
          marginBottom: isMobile ? '14px' : '28px',
        }}
      >
        <label
          style={{ display: 'block', color: COLORS.muted, fontSize: '13px', marginBottom: '6px' }}
        >
          Your Name
        </label>
        <input
          type="text"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          maxLength={24}
          placeholder="Enter your name"
          style={{
            width: '100%',
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: '8px',
            color: COLORS.white,
            padding: '10px 14px',
            fontSize: '15px',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Action cards */}
      <div
        style={{
          width: '100%',
          maxWidth: isMobile ? 'none' : '680px',
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: isMobile ? '10px' : '16px',
        }}
      >
        {/* Solo card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', height: '100%' }}>
          <button
            onClick={onPlaySolo}
            style={{
              flex: 1,
              background: `linear-gradient(135deg, #1a2a3a, #0f1f30)`,
              border: `2px solid ${COLORS.gold}55`,
              borderRadius: isMobile ? '12px' : '16px',
              padding: isMobile ? '14px 16px' : '28px 20px',
              cursor: 'pointer',
              color: COLORS.white,
              textAlign: isMobile ? 'left' : 'center',
              transition: 'all 0.2s',
              display: 'flex',
              flexDirection: isMobile ? 'row' : 'column',
              alignItems: 'center',
              gap: '10px',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.border = `2px solid ${COLORS.gold}`;
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.border = `2px solid ${COLORS.gold}55`;
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
            }}
          >
            <span style={{ fontSize: isMobile ? '24px' : '36px' }}>🤖</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: isMobile ? '15px' : '18px', fontWeight: 700, color: COLORS.gold }}>
                {hasSoloSave ? 'New Solo Game' : 'Play Solo'}
              </span>
              {!isMobile && (
                <span style={{ fontSize: '13px', color: COLORS.muted }}>
                  {hasSoloSave ? 'Start fresh against AI' : 'Play against AI opponents on this device'}
                </span>
              )}
            </div>
          </button>
          {hasSoloSave && (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={onResumeSolo}
                style={{
                  flex: 1,
                  background: `linear-gradient(135deg, #2a3a1a, #1a2a0a)`,
                  border: `2px solid ${COLORS.green}`,
                  borderRadius: '10px',
                  padding: '10px 14px',
                  cursor: 'pointer',
                  color: COLORS.white,
                  fontWeight: 700,
                  fontSize: '14px',
                }}
              >
                Resume
              </button>
              <button
                onClick={onDiscardSolo}
                title="Discard saved game"
                style={{
                  background: 'transparent',
                  border: `2px solid ${COLORS.red}66`,
                  borderRadius: '10px',
                  padding: '10px 14px',
                  cursor: 'pointer',
                  color: COLORS.red,
                  fontSize: '13px',
                  fontWeight: 600,
                }}
              >
                ✕ Discard
              </button>
            </div>
          )}
        </div>

        {/* Create multiplayer card */}
        <button
          onClick={handleCreate}
          disabled={isCreating}
          style={{
            background: `linear-gradient(135deg, #1e2a1a, #0f1f0a)`,
            border: `2px solid ${COLORS.green}55`,
            borderRadius: isMobile ? '12px' : '16px',
            padding: isMobile ? '14px 16px' : '28px 20px',
            cursor: isCreating ? 'wait' : 'pointer',
            color: COLORS.white,
            textAlign: isMobile ? 'left' : 'center',
            transition: 'all 0.2s',
            display: 'flex',
            flexDirection: isMobile ? 'row' : 'column',
            alignItems: 'center',
            gap: '10px',
            opacity: isCreating ? 0.7 : 1,
          }}
          onMouseEnter={(e) => {
            if (!isCreating) {
              (e.currentTarget as HTMLButtonElement).style.border = `2px solid ${COLORS.green}`;
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.border = `2px solid ${COLORS.green}55`;
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
          }}
        >
          <span style={{ fontSize: isMobile ? '24px' : '36px' }}>🏠</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: isMobile ? '15px' : '18px', fontWeight: 700, color: COLORS.green }}>
              {isCreating ? 'Creating...' : 'Create Game'}
            </span>
            {!isMobile && (
              <span style={{ fontSize: '13px', color: COLORS.muted }}>
                Host a multiplayer room and invite friends
              </span>
            )}
          </div>
        </button>

        {/* Join card */}
        <div
          style={{
            background: `linear-gradient(135deg, #1a1a2a, #0f0f1f)`,
            border: `2px solid ${COLORS.blue}${showJoin ? 'ff' : '55'}`,
            borderRadius: isMobile ? '12px' : '16px',
            padding: isMobile ? '14px 16px' : '28px 20px',
            cursor: 'default',
            color: COLORS.white,
            textAlign: isMobile ? 'left' : 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: isMobile ? '8px' : '10px',
            transition: 'border-color 0.2s',
          }}
        >
          {!showJoin ? (
            <div style={{ display: 'flex', flexDirection: isMobile ? 'row' : 'column', alignItems: 'center', gap: '10px', width: '100%' }}>
              <span style={{ fontSize: isMobile ? '24px' : '36px' }}>🚪</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                <span style={{ fontSize: isMobile ? '15px' : '18px', fontWeight: 700, color: COLORS.blue }}>
                  Join Game
                </span>
                {!isMobile && (
                  <span style={{ fontSize: '13px', color: COLORS.muted }}>
                    Enter a room code to join a friend's game
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowJoin(true)}
                style={{
                  background: COLORS.blue,
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 20px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Enter Code
              </button>
            </div>
          ) : (
            <>
              <span style={{ fontSize: isMobile ? '15px' : '18px', fontWeight: 700, color: COLORS.blue }}>
                Join Game
              </span>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  width: '100%',
                  alignItems: 'center',
                }}
              >
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value.toUpperCase().slice(0, 6));
                    setJoinError('');
                  }}
                  placeholder="ROOM CODE"
                  maxLength={6}
                  style={{
                    width: '100%',
                    background: '#0d1117',
                    border: `1px solid ${joinError ? COLORS.red : COLORS.cardBorder}`,
                    borderRadius: '8px',
                    color: COLORS.gold,
                    padding: '10px 12px',
                    fontSize: isMobile ? '16px' : '18px',
                    letterSpacing: '4px',
                    textAlign: 'center',
                    outline: 'none',
                    fontWeight: 700,
                    boxSizing: 'border-box',
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                />
                {joinError && (
                  <span style={{ color: COLORS.red, fontSize: '12px' }}>{joinError}</span>
                )}
                <button
                  onClick={handleJoin}
                  disabled={joinCode.length !== 6}
                  style={{
                    background: joinCode.length === 6 ? COLORS.blue : COLORS.cardBorder,
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 24px',
                    fontWeight: 700,
                    cursor: joinCode.length === 6 ? 'pointer' : 'not-allowed',
                    fontSize: '14px',
                    width: '100%',
                  }}
                >
                  Join
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <p
        style={{
          color: COLORS.muted,
          fontSize: '12px',
          marginTop: isMobile ? '16px' : '48px',
          textAlign: 'center',
        }}
      >
        2–4 players · Trade resources · Build your empire
      </p>
    </div>
  );
}
