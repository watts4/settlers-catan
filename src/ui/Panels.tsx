// The panels around the board: players, your hand, development cards, the
// build menu and the game log.

import { useEffect, useRef } from 'react';
import type { DevKind, GameState, PartialHand, Resource } from '../engine/types';
import { RESOURCES } from '../engine/types';
import { COST, handSize, longestRoadOf, piecesLeft, publicVP, totalVP, type Buildable } from '../engine/rules';
import { DEV_NAMES } from '../engine/game';
import { DevCardArt, ResourceIcon } from './art';
import { RES_COLOR, RES_LABEL } from './palette';

export function CostPips({ cost }: { cost: PartialHand }) {
  return (
    <span className="cost">
      {RESOURCES.flatMap((r) => Array.from({ length: cost[r] ?? 0 }, (_, i) => (
        <span key={`${r}${i}`} className="cost-pip" style={{ background: RES_COLOR[r] }} title={RES_LABEL[r]} />
      )))}
    </span>
  );
}

export function PlayerList({ state, me, waiting }: { state: GameState; me: number; waiting: number[] }) {
  return (
    <div className="players">
      {state.players.map((p, i) => {
        const reveal = i === me || state.phase === 'gameOver';
        const vp = reveal ? totalVP(state, i) : publicVP(state, i);
        const hidden = reveal ? totalVP(state, i) - publicVP(state, i) : 0;
        const cards = handSize(p.hand);
        const left = piecesLeft(state, i);
        const road = longestRoadOf(state, i);
        const isTurn = state.current === i && state.phase !== 'gameOver';
        return (
          <div key={i} data-seat={i} className={`player ${isTurn ? 'turn' : ''} ${i === me ? 'me' : ''} ${state.winner === i ? 'winner' : ''}`}
            style={{ '--pc': p.color } as React.CSSProperties}>
            <div className="player-top">
              <span className="swatch" />
              <span className="pname">{p.name}{i === me && p.name !== 'You' && <span className="you"> (you)</span>}</span>
              {p.controller === 'ai' && <span className="tag" title={`Computer, ${p.aiLevel}`}>CPU</span>}
              {waiting.includes(i) && !isTurn && <span className="thinking" title="Waiting on this player">…</span>}
              <span className="vp" title={hidden ? `${vp} points, including ${hidden} hidden` : `${vp} points`}>
                {vp}<small>VP</small>
              </span>
            </div>
            <div className="player-stats">
              <span title="Resource cards" className={cards > 7 ? 'warn' : ''}><i className="ico cards" />{cards}</span>
              <span title="Development cards"><i className="ico dev" />{p.devCards.length}</span>
              <span title="Knights played"><i className="ico knight" />{p.knights}</span>
              <span title="Longest road"><i className="ico road" />{road}</span>
              {state.longestRoad.holder === i && <span className="award" title="Longest Road: 2 points">🛣️</span>}
              {state.largestArmy.holder === i && <span className="award" title="Largest Army: 2 points">⚔️</span>}
            </div>
            <div className="pieces-left" title="Pieces left: roads, settlements, cities">
              {left.road} roads · {left.settlement} settl. · {left.city} cities
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function HandView({ state, me, onCard }: { state: GameState; me: number; onCard?: (r: Resource) => void }) {
  const hand = state.players[me].hand;
  return (
    <div className="hand" data-hand>
      {RESOURCES.map((r) => (
        <button key={r} type="button" className={`rcard ${hand[r] ? '' : 'empty'}`} data-res={r} style={{ '--rc': RES_COLOR[r] } as React.CSSProperties}
          onClick={onCard ? () => onCard(r) : undefined} title={`${RES_LABEL[r]}: ${hand[r]}`}>
          <ResourceIcon res={r} size={34} />
          <span className="rlabel">{RES_LABEL[r]}</span>
          <span className="rcount">{hand[r]}</span>
        </button>
      ))}
    </div>
  );
}

export function DevHand({ state, me, playable, onPlay }: { state: GameState; me: number; playable: DevKind[]; onPlay(k: DevKind): void }) {
  const cards = state.players[me].devCards;
  if (!cards.length) return null;
  const counts = new Map<DevKind, { n: number; fresh: number }>();
  for (const c of cards) {
    const e = counts.get(c.kind) ?? { n: 0, fresh: 0 };
    e.n++;
    if (c.boughtTurn === state.turn) e.fresh++;
    counts.set(c.kind, e);
  }
  return (
    <div className="devhand">
      {[...counts.entries()].map(([k, { n, fresh }]) => {
        const can = playable.includes(k);
        const why = k === 'victory' ? 'Counts toward your score automatically. Hidden from others.'
          : can ? `Play ${DEV_NAMES[k]}` : fresh === n ? 'Bought this turn: play it next turn.' : 'You can play one development card per turn.';
        return (
          <button key={k} type="button" className={`devcard ${can ? 'can' : ''} ${k}`} disabled={!can} onClick={() => onPlay(k)} title={why}>
            <DevCardArt kind={k} size={36} />
            <span className="dname">{DEV_NAMES[k]}</span>
            {n > 1 && <span className="dcount">×{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function BuildMenu({ state, me, mode, onBuild, reasons }: {
  state: GameState; me: number; mode: Buildable | null;
  onBuild(b: Buildable): void; reasons: Record<Buildable, string | null>;
}) {
  const items: [Buildable, string, string][] = [
    ['road', 'Road', '0 VP'], ['settlement', 'Settlement', '1 VP'], ['city', 'City', '2 VP'], ['dev', 'Dev card', '?'],
  ];
  void state; void me;
  return (
    <div className="build">
      {items.map(([b, label, vp]) => (
        <button key={b} type="button" className={`buildbtn ${mode === b ? 'active' : ''}`} disabled={!!reasons[b]} onClick={() => onBuild(b)}
          title={reasons[b] ?? (mode === b ? 'Click again to cancel' : `Build a ${label.toLowerCase()} (${vp})`)}>
          <span className="blabel">{label}</span>
          <CostPips cost={COST[b]} />
        </button>
      ))}
    </div>
  );
}

// "Ana places a settlement" reads as "You place a settlement" on Ana's screen.
function personal(text: string, name: string): string {
  if (!name) return text;
  let t = text;
  if (t.startsWith(`${name} `)) {
    const rest = t.slice(name.length + 1);
    const sp = rest.indexOf(' ');
    const verb = sp < 0 ? rest : rest.slice(0, sp);
    const base = verb === 'goes' ? 'go' : verb.endsWith('s') && !verb.endsWith('ss') ? verb.slice(0, -1) : verb;
    t = `You ${base}${sp < 0 ? '' : rest.slice(sp)}`.replace(' and collects ', ' and collect ');
  }
  return t.replace(new RegExp(`\\b(robs|to|from) ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '$1 you');
}

export function GameLog({ state, me }: { state: GameState; me: number }) {
  const myName = state.players[me]?.name ?? '';
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.log.length]);
  return (
    <div className="log" ref={box} aria-live="polite">
      {state.log.slice(-80).map((l, i) => (
        <div key={i} className="logline" style={{ '--pc': l.player !== null ? state.players[l.player]?.color : 'transparent' } as React.CSSProperties}>
          {personal(l.text, myName)}
        </div>
      ))}
    </div>
  );
}

export function BankView({ state }: { state: GameState }) {
  return (
    <div className="bank">
      {RESOURCES.map((r) => (
        <span key={r} title={`${RES_LABEL[r]} left in the bank`} className={state.bank[r] < 4 ? 'low' : ''}>
          <ResourceIcon res={r} size={18} />{state.bank[r]}
        </span>
      ))}
      <span title="Development cards left"><DevCardArt kind="knight" size={18} />{state.devDeck.length}</span>
    </div>
  );
}

// How often each total has been rolled, against what the odds predict.
export function RollChart({ state }: { state: GameState }) {
  const rolls = state.rolls ?? {};
  const total = Object.values(rolls).reduce((a, b) => a + b, 0);
  const sums = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const ways = (n: number) => 6 - Math.abs(7 - n);
  const max = Math.max(1, ...sums.map((n) => rolls[n] ?? 0), ...sums.map((n) => (total * ways(n)) / 36));
  const last = state.dice ? state.dice.a + state.dice.b : null;
  return (
    <div className="rollchart" title={`${total} rolls so far. Faint bars show what the odds predict.`}>
      <div className="bars">
        {sums.map((n) => {
          const got = rolls[n] ?? 0;
          const exp = (total * ways(n)) / 36;
          return (
            <div key={n} className="barcol">
              <div className="barbox">
                <div className="bar-exp" style={{ height: `${(exp / max) * 100}%` }} />
                <div className={`bar ${n === 7 ? 'seven' : ''} ${n === last ? 'last' : ''}`} style={{ height: `${(got / max) * 100}%` }} />
              </div>
              <span className="barn">{n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
