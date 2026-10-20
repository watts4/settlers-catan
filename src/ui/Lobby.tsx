// Waiting room for an online game. The host picks settings and starts; empty
// seats become computer players.

import { useState } from 'react';
import type { AiLevel } from '../engine/types';
import { createGame, PLAYER_COLORS } from '../engine/game';
import { startRoom, updateSeats, type Room } from '../net/rooms';

export function Lobby({ room, me, onLeave }: { room: Room; me: number; onLeave(): void }) {
  const isHost = me === 0;
  const [level, setLevel] = useState<AiLevel>('normal');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const opts = room.options ?? { seats: 4, vpToWin: 10, friendlyRobber: false };
  const link = `${window.location.origin}${window.location.pathname}?room=${room.id}`;

  const start = async () => {
    setBusy(true);
    const players = Array.from({ length: opts.seats }, (_, slot) => {
      const seat = room.players.find((p) => p.slot === slot && p.isHuman);
      return seat
        ? { name: seat.name, controller: 'human' as const, color: PLAYER_COLORS[slot] }
        : { name: ['Hildeguard', 'Steve', 'Tammy', 'Oswin'][slot], controller: 'ai' as const, aiLevel: level, color: PLAYER_COLORS[slot] };
    });
    const state = createGame({ players, vpToWin: opts.vpToWin, friendlyRobber: opts.friendlyRobber });
    try { await startRoom(room.id, state); } finally { setBusy(false); }
  };

  const setOpt = (o: Partial<NonNullable<Room['options']>>) => updateSeats(room.id, room.players, { ...opts, ...o });

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>Room <span className="roomcode">{room.id}</span></h1>
        <p className="muted">Send this link to friends. They join from their own phone or computer.</p>
        <div className="join">
          <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
          <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <ul className="seats">
          {Array.from({ length: opts.seats }, (_, slot) => {
            const seat = room.players.find((p) => p.slot === slot && p.isHuman);
            return (
              <li key={slot} style={{ '--pc': PLAYER_COLORS[slot] } as React.CSSProperties}>
                <span className="swatch" />
                {seat ? <strong>{seat.name}{slot === me ? ' (you)' : ''}{slot === 0 ? ' · host' : ''}</strong> : <span className="muted">Open: a computer plays if nobody joins</span>}
              </li>
            );
          })}
        </ul>

        {isHost ? (
          <div className="lobby-opts">
            <div className="field">
              <span className="flabel">Players</span>
              <div className="seg">
                {[3, 4].map((n) => (
                  <button key={n} type="button" className={opts.seats === n ? 'on' : ''} disabled={room.players.some((p) => p.isHuman && p.slot >= n)} onClick={() => setOpt({ seats: n })}>{n}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="flabel">Computer players</span>
              <div className="seg">
                {(['easy', 'normal', 'hard'] as AiLevel[]).map((l) => (
                  <button key={l} type="button" className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>{l[0].toUpperCase() + l.slice(1)}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="flabel">Points to win</span>
              <div className="seg">
                {[8, 10, 12].map((n) => <button key={n} type="button" className={opts.vpToWin === n ? 'on' : ''} onClick={() => setOpt({ vpToWin: n })}>{n}</button>)}
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={opts.friendlyRobber} onChange={(e) => setOpt({ friendlyRobber: e.target.checked })} /> Friendly robber
            </label>
            <button type="button" className="btn primary big wide" disabled={busy} onClick={start}>Start the game</button>
          </div>
        ) : (
          <p className="waiting">Waiting for the host to start…</p>
        )}
        <button type="button" className="linkbtn" onClick={onLeave}>Leave room</button>
      </div>
    </div>
  );
}
