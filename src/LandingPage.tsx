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
  onViewProfile?: () => void;
  isSignedIn?: boolean;
}

// Rustic outback theme colors
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
  red: '#8b2020',
  redBright: '#c0392b',
  green: '#4a7a30',
  greenBright: '#5d9b3a',
  blue: '#2a5a8a',
  orange: '#c87820',
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
  onViewProfile,
  isSignedIn,
}: LandingPageProps) {
  const isMobile = useIsMobile();
  const [user, setUser] = useState<User | null>(null);
  const [playerName, setPlayerName] = useState<string>('Player 1');
  const [joinCode, setJoinCode] = useState<string>('');
  const [showJoin, setShowJoin] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [joinError, setJoinError] = useState<string>('');

  // Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
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
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error('Sign-in failed:', err);
    }
  }

  async function handleSignOut() {
    try {
      await signOut(auth);
      setPlayerName('Player 1');
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
    onJoinMultiplayer(code, playerName.trim() || 'Player 1');
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: `
          radial-gradient(ellipse at 30% 20%, rgba(107, 52, 16, 0.3) 0%, transparent 60%),
          radial-gradient(ellipse at 70% 80%, rgba(139, 94, 47, 0.2) 0%, transparent 50%),
          linear-gradient(180deg, #1a1008 0%, #2a1a0e 40%, #1a1008 100%)
        `,
        color: COLORS.cream,
        fontFamily: "'Georgia', 'Palatino', serif",
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: isMobile ? '16px 12px' : '32px 16px',
        boxSizing: 'border-box',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          width: '100%',
          maxWidth: isMobile ? 'none' : '640px',
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: isMobile ? '12px' : '20px',
        }}
      >
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ color: COLORS.muted, fontSize: '13px' }}>
              {user.displayName ?? user.email}
            </span>
            {user && isSignedIn && onViewProfile && (
              <button
                onClick={onViewProfile}
                style={{
                  ...btnBase,
                  background: `linear-gradient(180deg, ${COLORS.woodLight}, ${COLORS.wood})`,
                  border: `1px solid ${COLORS.cardBorder}`,
                  color: COLORS.goldBright,
                  padding: '5px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                My Profile
              </button>
            )}
            <button
              onClick={handleSignOut}
              style={{
                ...btnBase,
                background: 'transparent',
                border: `1px solid ${COLORS.cardBorder}`,
                color: COLORS.muted,
                padding: '5px 14px',
                borderRadius: '6px',
                fontSize: '12px',
              }}
            >
              Sign Out
            </button>
          </div>
        ) : (
          <button
            onClick={handleSignIn}
            style={{
              ...btnBase,
              background: `linear-gradient(180deg, ${COLORS.woodLight}, ${COLORS.wood})`,
              border: `1px solid ${COLORS.cardBorder}`,
              color: COLORS.cream,
              padding: '8px 18px',
              borderRadius: '8px',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
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
      <div style={{ textAlign: 'center', marginBottom: isMobile ? '20px' : '36px' }}>
        <h1
          style={{
            fontSize: isMobile ? '28px' : 'clamp(32px, 6vw, 52px)',
            fontWeight: 700,
            color: COLORS.goldBright,
            margin: '0 0 6px',
            letterSpacing: '1px',
            textShadow: `0 2px 12px rgba(212, 160, 32, 0.4), 0 0 40px rgba(212, 160, 32, 0.15)`,
            fontFamily: "'Georgia', 'Palatino', serif",
          }}
        >
          Settlers of Catan
        </h1>
        <div
          style={{
            width: isMobile ? '60px' : '80px',
            height: '2px',
            background: `linear-gradient(90deg, transparent, ${COLORS.gold}, transparent)`,
            margin: '8px auto 10px',
          }}
        />
        <p style={{ color: COLORS.parchment, margin: 0, fontSize: isMobile ? '13px' : '15px', fontStyle: 'italic', opacity: 0.8 }}>
          Build, trade, and conquer the island
        </p>
      </div>

      {/* Rejoin banner */}
      {savedGame && (
        <div
          style={{
            width: '100%',
            maxWidth: isMobile ? 'none' : '640px',
            background: `linear-gradient(135deg, rgba(74, 122, 48, 0.25), rgba(40, 70, 25, 0.3))`,
            border: `1px solid ${COLORS.green}66`,
            borderRadius: '10px',
            padding: '14px 20px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ color: COLORS.greenBright, fontWeight: 600, fontSize: '14px' }}>
            You have an active multiplayer game
          </span>
          <button
            onClick={() => onRejoinGame(savedGame.roomId, savedGame.slot)}
            style={{
              ...btnBase,
              background: `linear-gradient(180deg, ${COLORS.greenBright}, ${COLORS.green})`,
              color: '#fff',
              borderRadius: '8px',
              padding: '8px 20px',
              fontWeight: 700,
              fontSize: '13px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
          >
            Rejoin Game
          </button>
        </div>
      )}

      {/* Action cards */}
      <div
        style={{
          width: '100%',
          maxWidth: isMobile ? 'none' : '640px',
          display: 'flex',
          flexDirection: 'column',
          gap: isMobile ? '12px' : '14px',
        }}
      >
        {/* Solo play button */}
        <button
          onClick={onPlaySolo}
          style={{
            ...btnBase,
            background: `linear-gradient(180deg, ${COLORS.wood} 0%, ${COLORS.woodDark} 100%)`,
            border: `2px solid ${COLORS.gold}55`,
            borderRadius: '12px',
            padding: isMobile ? '16px 20px' : '22px 28px',
            color: COLORS.cream,
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 16px rgba(0,0,0,0.4)`,
            textShadow: '0 1px 3px rgba(0,0,0,0.5)',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = COLORS.gold;
            (e.currentTarget as HTMLButtonElement).style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 20px rgba(212, 160, 32, 0.25)`;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = `${COLORS.gold}55`;
            (e.currentTarget as HTMLButtonElement).style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 16px rgba(0,0,0,0.4)`;
          }}
        >
          <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>&#x2694;&#xFE0F;</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left' }}>
            <span style={{ fontSize: isMobile ? '16px' : '18px', fontWeight: 700, color: COLORS.goldBright }}>
              {hasSoloSave ? 'New Solo Game' : 'Play Solo'}
            </span>
            <span style={{ fontSize: '12px', color: COLORS.parchment, opacity: 0.7 }}>
              {hasSoloSave ? 'Start fresh against AI' : 'Battle AI opponents on this device'}
            </span>
          </div>
        </button>

        {/* Resume / Discard row */}
        {hasSoloSave && (
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={onResumeSolo}
              style={{
                ...btnBase,
                flex: 1,
                background: `linear-gradient(180deg, ${COLORS.greenBright}, ${COLORS.green})`,
                color: '#fff',
                borderRadius: '10px',
                padding: '12px 18px',
                fontWeight: 700,
                fontSize: '15px',
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.15), 0 3px 10px rgba(0,0,0,0.3)`,
                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
                (e.currentTarget as HTMLButtonElement).style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.15), 0 5px 16px rgba(0,0,0,0.4)`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
                (e.currentTarget as HTMLButtonElement).style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.15), 0 3px 10px rgba(0,0,0,0.3)`;
              }}
            >
              Resume Saved Game
            </button>
            <button
              onClick={onDiscardSolo}
              title="Discard saved game"
              style={{
                ...btnBase,
                background: `linear-gradient(180deg, ${COLORS.red}, #5a1515)`,
                border: `1px solid ${COLORS.redBright}44`,
                borderRadius: '10px',
                padding: '12px 18px',
                color: '#daa',
                fontSize: '13px',
                fontWeight: 600,
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = '#fcc';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = '#daa';
              }}
            >
              Discard
            </button>
          </div>
        )}

        {/* Divider */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          margin: isMobile ? '4px 0' : '6px 0',
        }}>
          <div style={{ flex: 1, height: '1px', background: `linear-gradient(90deg, transparent, ${COLORS.cardBorder}, transparent)` }} />
          <span style={{ color: COLORS.muted, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '2px' }}>Multiplayer</span>
          <div style={{ flex: 1, height: '1px', background: `linear-gradient(90deg, transparent, ${COLORS.cardBorder}, transparent)` }} />
        </div>

        {/* Multiplayer buttons row */}
        <div style={{ display: 'flex', gap: '10px' }}>
          {/* Create game */}
          <button
            onClick={handleCreate}
            disabled={isCreating}
            style={{
              ...btnBase,
              flex: 1,
              background: `linear-gradient(180deg, ${COLORS.woodLight} 0%, ${COLORS.wood} 100%)`,
              border: `2px solid ${COLORS.cardBorder}`,
              borderRadius: '12px',
              padding: isMobile ? '14px 16px' : '18px 20px',
              color: COLORS.cream,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              opacity: isCreating ? 0.7 : 1,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 3px 12px rgba(0,0,0,0.35)`,
              textShadow: '0 1px 2px rgba(0,0,0,0.4)',
            }}
            onMouseEnter={(e) => {
              if (!isCreating) {
                (e.currentTarget as HTMLButtonElement).style.borderColor = COLORS.gold;
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = COLORS.cardBorder;
            }}
          >
            <span style={{ fontSize: isMobile ? '15px' : '17px', fontWeight: 700, color: COLORS.goldBright }}>
              {isCreating ? 'Creating...' : 'Create Game'}
            </span>
            <span style={{ fontSize: '11px', color: COLORS.parchment, opacity: 0.6 }}>
              Host a room
            </span>
          </button>

          {/* Join game */}
          <div
            style={{
              flex: 1,
              background: `linear-gradient(180deg, ${COLORS.woodLight} 0%, ${COLORS.wood} 100%)`,
              border: `2px solid ${showJoin ? COLORS.gold : COLORS.cardBorder}`,
              borderRadius: '12px',
              padding: isMobile ? '14px 16px' : '18px 20px',
              color: COLORS.cream,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 3px 12px rgba(0,0,0,0.35)`,
              transition: 'border-color 0.2s',
            }}
          >
            {!showJoin ? (
              <button
                onClick={() => setShowJoin(true)}
                style={{
                  ...btnBase,
                  background: 'transparent',
                  color: COLORS.cream,
                  padding: 0,
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  textShadow: '0 1px 2px rgba(0,0,0,0.4)',
                }}
              >
                <span style={{ fontSize: isMobile ? '15px' : '17px', fontWeight: 700, color: COLORS.goldBright }}>
                  Join Game
                </span>
                <span style={{ fontSize: '11px', color: COLORS.parchment, opacity: 0.6 }}>
                  Enter room code
                </span>
              </button>
            ) : (
              <>
                <span style={{ fontSize: isMobile ? '14px' : '15px', fontWeight: 700, color: COLORS.goldBright, marginBottom: '2px' }}>
                  Enter Room Code
                </span>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value.toUpperCase().slice(0, 6));
                    setJoinError('');
                  }}
                  placeholder="ABCDEF"
                  maxLength={6}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.35)',
                    border: `1px solid ${joinError ? COLORS.redBright : COLORS.cardBorder}`,
                    borderRadius: '6px',
                    color: COLORS.goldBright,
                    padding: '8px 10px',
                    fontSize: isMobile ? '16px' : '17px',
                    letterSpacing: '4px',
                    textAlign: 'center',
                    outline: 'none',
                    fontWeight: 700,
                    boxSizing: 'border-box',
                    fontFamily: "'Georgia', 'Palatino', serif",
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                />
                {joinError && (
                  <span style={{ color: COLORS.redBright, fontSize: '11px' }}>{joinError}</span>
                )}
                <button
                  onClick={handleJoin}
                  disabled={joinCode.length !== 6}
                  style={{
                    ...btnBase,
                    background: joinCode.length === 6
                      ? `linear-gradient(180deg, ${COLORS.greenBright}, ${COLORS.green})`
                      : `rgba(60, 40, 20, 0.5)`,
                    color: joinCode.length === 6 ? '#fff' : COLORS.muted,
                    borderRadius: '6px',
                    padding: '8px 20px',
                    fontWeight: 700,
                    cursor: joinCode.length === 6 ? 'pointer' : 'not-allowed',
                    fontSize: '13px',
                    width: '100%',
                    boxShadow: joinCode.length === 6 ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
                  }}
                >
                  Join
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <p
        style={{
          color: COLORS.muted,
          fontSize: '11px',
          marginTop: isMobile ? '24px' : '48px',
          textAlign: 'center',
          fontStyle: 'italic',
          letterSpacing: '0.5px',
        }}
      >
        2-4 players &middot; Trade resources &middot; Build your empire
      </p>
    </div>
  );
}
