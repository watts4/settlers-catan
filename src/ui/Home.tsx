// The front door: start a game against the computer, resume one, or play
// online with friends.

import { useEffect, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth } from '../firebase';
import type { AiLevel } from '../engine/types';
import { sound } from '../audio/sound';
import { PLAYER_COLORS, COLOR_NAMES } from '../engine/game';
import { HeroIsland } from './HeroIsland';

export interface SoloOptions {
  name: string;
  opponents: number;
  level: AiLevel;
  vpToWin: number;
  friendlyRobber: boolean;
  color: number;
}

interface Props {
  hasSave: boolean;
  savedSummary: string | null;
  onSolo(o: SoloOptions): void;
  onResume(): void;
  onDiscardSave(): void;
  onCreate(name: string): Promise<string | null>;
  onJoin(code: string, name: string): Promise<string | null>;
  onProfile(): void;
  rejoin: { roomId: string } | null;
  onRejoin(): void;
  initialCode: string | null;
}

const NAME_KEY = 'catan_player_name';
const OPTS_KEY = 'catan2_solo_opts';

export function Home(props: Props) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const saved = (() => { try { return JSON.parse(localStorage.getItem(OPTS_KEY) ?? '{}'); } catch { return {}; } })();
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [opponents, setOpponents] = useState<number>(saved.opponents ?? 3);
  const [level, setLevel] = useState<AiLevel>(saved.level ?? 'normal');
  const [vpToWin, setVp] = useState<number>(saved.vpToWin ?? 10);
  const [friendly, setFriendly] = useState<boolean>(saved.friendlyRobber ?? false);
  const [color, setColor] = useState<number>(saved.color ?? 0);
  const [code, setCode] = useState(props.initialCode ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    if (u && !u.isAnonymous && u.displayName && !localStorage.getItem(NAME_KEY)) setName(u.displayName.split(' ')[0]);
  }), []);

  const finalName = name.trim() || 'You';
  const remember = () => {
    localStorage.setItem(NAME_KEY, name.trim());
    localStorage.setItem(OPTS_KEY, JSON.stringify({ opponents, level, vpToWin, friendlyRobber: friendly, color }));
    sound.unlock();
  };

  const signedIn = user && !user.isAnonymous;

  return (
    <div className="home">
      <div className="home-hero">
        <HeroIsland />
        <div className="home-title">
          <h1>Settlers<span>of Catan</span></h1>
          <p>Build roads, raise cities, and outtrade three rivals for control of the island.</p>
        </div>
      </div>

      <div className="home-grid">
        <section className="home-card solo">
          <h2>Play the computer</h2>
          <div className="field">
            <label htmlFor="pname">Your name</label>
            <input id="pname" value={name} maxLength={16} placeholder="You" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <span className="flabel">Your colour</span>
            <div className="colors" role="radiogroup" aria-label="Your colour">
              {PLAYER_COLORS.slice(0, 4).map((c, i) => (
                <button key={c} type="button" role="radio" aria-checked={color === i} title={COLOR_NAMES[i]}
                  className={`colorpick ${color === i ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(i)} />
              ))}
            </div>
          </div>
          <div className="field">
            <span className="flabel">Opponents</span>
            <div className="seg">
              {[2, 3].map((n) => <button key={n} type="button" className={opponents === n ? 'on' : ''} onClick={() => setOpponents(n)}>{n}</button>)}
            </div>
          </div>
          <div className="field">
            <span className="flabel">Difficulty</span>
            <div className="seg">
              {(['easy', 'normal', 'hard'] as AiLevel[]).map((l) => (
                <button key={l} type="button" className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>{l[0].toUpperCase() + l.slice(1)}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="flabel">Points to win</span>
            <div className="seg">
              {[8, 10, 12].map((n) => <button key={n} type="button" className={vpToWin === n ? 'on' : ''} onClick={() => setVp(n)}>{n}</button>)}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={friendly} onChange={(e) => setFriendly(e.target.checked)} />
            Friendly robber <small>(leaves players with 2 points or fewer alone)</small>
          </label>
          <button type="button" className="btn primary big wide" onClick={() => {
            remember();
            props.onSolo({ name: finalName, opponents, level, vpToWin, friendlyRobber: friendly, color });
          }}>New game</button>
          {props.hasSave && (
            <div className="resume">
              <button type="button" className="btn wide" onClick={() => { sound.unlock(); props.onResume(); }}>
                Resume game{props.savedSummary ? <small> · {props.savedSummary}</small> : null}
              </button>
              <button type="button" className="linkbtn" onClick={props.onDiscardSave}>discard</button>
            </div>
          )}
        </section>

        <section className="home-card online">
          <h2>Play with friends</h2>
          <p className="muted">Start a room and send the link. Empty seats are filled by computer players when you start.</p>
          {props.rejoin && (
            <button type="button" className="btn wide" onClick={props.onRejoin}>Rejoin room {props.rejoin.roomId}</button>
          )}
          <button type="button" className="btn primary wide" disabled={busy} onClick={async () => {
            remember(); setBusy(true); setErr(null);
            const e = await props.onCreate(finalName);
            setBusy(false); if (e) setErr(e);
          }}>Create a room</button>
          <div className="join">
            <input aria-label="Room code" placeholder="Room code" value={code} maxLength={8}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
            <button type="button" className="btn" disabled={busy || code.length < 4} onClick={async () => {
              remember(); setBusy(true); setErr(null);
              const e = await props.onJoin(code, finalName);
              setBusy(false); if (e) setErr(e);
            }}>Join</button>
          </div>
          {err && <p className="err">{err}</p>}

          <div className="account">
            {signedIn ? (
              <>
                <span className="muted">Signed in as {user!.displayName}</span>
                <button type="button" className="linkbtn" onClick={props.onProfile}>Your stats & badges</button>
                <button type="button" className="linkbtn" onClick={() => signOut(auth)}>Sign out</button>
              </>
            ) : (
              <>
                <span className="muted">Sign in to track wins and earn badges.</span>
                <button type="button" className="btn small" onClick={() => signInWithPopup(auth, new GoogleAuthProvider()).catch(() => setErr('Google sign-in didn\'t work here.'))}>
                  Sign in with Google
                </button>
              </>
            )}
          </div>
        </section>
      </div>
      <footer className="home-foot">Rebuilt October 2026 · sound on for the full effect</footer>
    </div>
  );
}
