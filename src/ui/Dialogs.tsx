// Pop-up panels: trading, discarding, picking resources, robbing, the end of
// the game, rules and settings.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { GameState, PartialHand, Resource } from '../engine/types';
import { RESOURCES } from '../engine/types';
import { COST, handSize, longestRoadOf, totalVP, tradeRates } from '../engine/rules';
import { ResourceIcon } from './art';
import { RES_LABEL } from './palette';
import { CostPips } from './Panels';
import { sound } from '../audio/sound';

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose?: () => void; wide?: boolean }) {
  useEffect(() => {
    if (!onClose) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && <button type="button" className="x" onClick={onClose} aria-label="Close">✕</button>}
        </div>
        {children}
      </div>
    </div>
  );
}

function Stepper({ hand, setHand, max, label, total }: { hand: PartialHand; setHand(h: PartialHand): void; max?: Partial<Record<Resource, number>>; label: string; total?: number }) {
  const full = total !== undefined && handSize(hand) >= total;
  return (
    <div className="stepper" aria-label={label}>
      {RESOURCES.map((r) => {
        const n = hand[r] ?? 0;
        const cap = max?.[r] ?? 19;
        return (
          <div key={r} className="step">
            <button type="button" className="step-card" disabled={n >= cap || full} onClick={() => setHand({ ...hand, [r]: n + 1 })} title={`Add ${RES_LABEL[r]}`}>
              <ResourceIcon res={r} size={30} />
              <span className="step-n">{n}</span>
            </button>
            <button type="button" className="step-minus" disabled={n <= 0} onClick={() => setHand({ ...hand, [r]: n - 1 })} aria-label={`Remove ${RES_LABEL[r]}`}>−</button>
          </div>
        );
      })}
    </div>
  );
}

export function HandChips({ hand }: { hand: PartialHand }) {
  const items = RESOURCES.filter((r) => (hand[r] ?? 0) > 0);
  if (!items.length) return <span className="muted">nothing</span>;
  return (
    <span className="chips">
      {items.map((r) => <span key={r} className="chip"><ResourceIcon res={r} size={20} />{hand[r]}</span>)}
    </span>
  );
}

export function TradeDialog({ state, me, onClose, dispatch }: {
  state: GameState; me: number; onClose(): void; dispatch(a: import('../engine/types').Action): Promise<string | null>;
}) {
  const [tab, setTab] = useState<'bank' | 'players'>(state.trade ? 'players' : 'bank');
  const rates = tradeRates(state, me);
  const hand = state.players[me].hand;
  const [give, setGive] = useState<Resource | null>(null);
  const [get, setGet] = useState<Resource | null>(null);
  const [offerGive, setOfferGive] = useState<PartialHand>({});
  const [offerGet, setOfferGet] = useState<PartialHand>({});
  const [err, setErr] = useState<string | null>(null);
  const trade = state.trade && state.trade.from === me ? state.trade : null;

  const doBank = async () => {
    if (!give || !get) return;
    const e = await dispatch({ type: 'bankTrade', player: me, give, get });
    setErr(e);
    if (!e) { sound.play('trade'); setGet(null); if (hand[give] - rates[give] < rates[give]) setGive(null); }
  };
  const doOffer = async () => {
    const e = await dispatch({ type: 'offerTrade', player: me, give: offerGive, get: offerGet });
    setErr(e);
  };

  return (
    <Modal title="Trade" onClose={onClose} wide>
      <div className="tabs">
        <button type="button" className={tab === 'bank' ? 'on' : ''} onClick={() => setTab('bank')}>Bank & harbours</button>
        <button type="button" className={tab === 'players' ? 'on' : ''} onClick={() => setTab('players')}>Other players</button>
      </div>
      {tab === 'bank' ? (
        <div className="bank-trade">
          <p className="hint">Give</p>
          <div className="pickrow">
            {RESOURCES.map((r) => (
              <button key={r} type="button" className={`pick ${give === r ? 'on' : ''}`} disabled={hand[r] < rates[r]} onClick={() => setGive(r)}>
                <ResourceIcon res={r} size={34} />
                <span>{rates[r]}:1</span>
                <small>{hand[r]} in hand</small>
              </button>
            ))}
          </div>
          <p className="hint">Get</p>
          <div className="pickrow">
            {RESOURCES.map((r) => (
              <button key={r} type="button" className={`pick ${get === r ? 'on' : ''}`} disabled={r === give || state.bank[r] < 1} onClick={() => setGet(r)}>
                <ResourceIcon res={r} size={34} />
                <span>{RES_LABEL[r]}</span>
                <small>{state.bank[r]} in bank</small>
              </button>
            ))}
          </div>
          <div className="row end">
            {err && <span className="err">{err}</span>}
            <button type="button" className="btn primary" disabled={!give || !get} onClick={doBank}>
              {give && get ? `Trade ${rates[give]} ${RES_LABEL[give]} for 1 ${RES_LABEL[get]}` : 'Pick what to give and get'}
            </button>
          </div>
        </div>
      ) : trade ? (
        <div className="offer-status">
          <p>You offered <HandChips hand={trade.give} /> for <HandChips hand={trade.get} /></p>
          <ul className="responses">
            {Object.entries(trade.responses).map(([k, v]) => (
              <li key={k}>
                <span className="dot" style={{ background: state.players[+k].color }} />
                <span>{state.players[+k].name}</span>
                <span className={`resp ${v}`}>{v === 'pending' ? 'thinking…' : v === 'accept' ? 'accepts' : 'declines'}</span>
                {v === 'accept' && (
                  <button type="button" className="btn primary small" onClick={async () => { const e = await dispatch({ type: 'acceptTrade', player: me, partner: +k }); setErr(e); if (!e) { sound.play('trade'); setOfferGive({}); setOfferGet({}); } }}>
                    Trade with {state.players[+k].name}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="row end">
            {err && <span className="err">{err}</span>}
            <button type="button" className="btn" onClick={async () => { const e = await dispatch({ type: 'cancelTrade', player: me }); if (!e) { setOfferGive({}); setOfferGet({}); } }}>Withdraw offer</button>
          </div>
        </div>
      ) : (
        <div className="player-trade">
          <p className="hint">You give</p>
          <Stepper hand={offerGive} setHand={setOfferGive} max={hand} label="You give" />
          <p className="hint">You want</p>
          <Stepper hand={offerGet} setHand={setOfferGet} label="You want" />
          <div className="row end">
            {err && <span className="err">{err}</span>}
            <button type="button" className="btn primary" disabled={!handSize(offerGive) || !handSize(offerGet) || RESOURCES.some((r) => (offerGive[r] ?? 0) > hand[r])} onClick={doOffer}>Offer to everyone</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function IncomingOffer({ state, me, dispatch }: { state: GameState; me: number; dispatch(a: import('../engine/types').Action): Promise<string | null> }) {
  const t = state.trade;
  if (!t || t.from === me || t.responses[me] === undefined) return null;
  const mine = t.responses[me];
  const can = RESOURCES.every((r) => state.players[me].hand[r] >= (t.get[r] ?? 0));
  const from = state.players[t.from];
  return (
    <div className="incoming" style={{ '--pc': from.color } as React.CSSProperties}>
      <div className="incoming-title"><span className="dot" style={{ background: from.color }} />{from.name} offers a trade</div>
      <div className="incoming-body">
        <div><small>You get</small><HandChips hand={t.give} /></div>
        <div><small>You give</small><HandChips hand={t.get} /></div>
      </div>
      {mine === 'pending' ? (
        <div className="row">
          <button type="button" className="btn primary small" disabled={!can} title={can ? '' : 'You don\'t have those cards'}
            onClick={() => dispatch({ type: 'respondTrade', player: me, accept: true })}>Accept</button>
          <button type="button" className="btn small" onClick={() => dispatch({ type: 'respondTrade', player: me, accept: false })}>Decline</button>
        </div>
      ) : (
        <div className="muted">{mine === 'accept' ? `Accepted. Waiting for ${from.name}…` : 'Declined.'}</div>
      )}
    </div>
  );
}

export function DiscardDialog({ state, me, due, dispatch }: { state: GameState; me: number; due: number; dispatch(a: import('../engine/types').Action): Promise<string | null> }) {
  const [pick, setPick] = useState<PartialHand>({});
  const n = handSize(pick);
  return (
    <Modal title={`Discard ${due} cards`}>
      <p>A seven was rolled and you hold {handSize(state.players[me].hand)} cards. Choose {due} to give back to the bank.</p>
      <Stepper hand={pick} setHand={setPick} max={state.players[me].hand} label="Discard" total={due} />
      <div className="row end">
        <span className={n === due ? 'ok' : 'muted'}>{n} / {due}</span>
        <button type="button" className="btn primary" disabled={n !== due} onClick={() => { sound.play('discard'); void dispatch({ type: 'discard', player: me, cards: pick }); }}>Discard</button>
      </div>
    </Modal>
  );
}

export function StealDialog({ state, targets, onPick }: { state: GameState; targets: number[]; onPick(p: number): void }) {
  return (
    <Modal title="Rob a player">
      <p>Take one random card from:</p>
      <div className="steal-list">
        {targets.map((p) => (
          <button key={p} type="button" className="btn steal" onClick={() => onPick(p)} style={{ '--pc': state.players[p].color } as React.CSSProperties}>
            <span className="dot" style={{ background: state.players[p].color }} />
            {state.players[p].name}
            <small>{handSize(state.players[p].hand)} cards</small>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function YearOfPlentyDialog({ state, onPick, onClose }: { state: GameState; onPick(h: PartialHand): void; onClose(): void }) {
  const [pick, setPick] = useState<PartialHand>({});
  const n = handSize(pick);
  return (
    <Modal title="Year of Plenty" onClose={onClose}>
      <p>Take any two resources from the bank.</p>
      <Stepper hand={pick} setHand={setPick} max={Object.fromEntries(RESOURCES.map((r) => [r, Math.min(2, state.bank[r])]))} label="Take" total={2} />
      <div className="row end">
        <span className={n === 2 ? 'ok' : 'muted'}>{n} / 2</span>
        <button type="button" className="btn primary" disabled={n !== 2} onClick={() => onPick(pick)}>Take them</button>
      </div>
    </Modal>
  );
}

export function MonopolyDialog({ onPick, onClose }: { onPick(r: Resource): void; onClose(): void }) {
  return (
    <Modal title="Monopoly" onClose={onClose}>
      <p>Name a resource. Every other player hands you all of theirs.</p>
      <div className="pickrow">
        {RESOURCES.map((r) => (
          <button key={r} type="button" className="pick" onClick={() => onPick(r)}>
            <ResourceIcon res={r} size={40} /><span>{RES_LABEL[r]}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function GameOverDialog({ state, me, onNew, onMenu, onClose }: { state: GameState; me: number; onNew?: () => void; onMenu(): void; onClose(): void }) {
  const order = useMemo(() => state.players.map((_, i) => i).sort((a, b) => totalVP(state, b) - totalVP(state, a)), [state]);
  const won = state.winner === me;
  return (
    <Modal title={won ? 'You win!' : `${state.players[state.winner ?? 0].name} wins`} onClose={onClose} wide>
      <p className="gameover-sub">{won ? 'The island is yours.' : 'Better luck on the next island.'} The game took {state.turn} turns.</p>
      <div className="scores-wrap">
      <table className="scores">
        <thead>
          <tr><th>Player</th><th>Points</th><th>Settl.</th><th>Cities</th><th>VP cards</th><th>Road</th><th>Army</th><th>Cards earned</th></tr>
        </thead>
        <tbody>
          {order.map((p) => {
            const pl = state.players[p];
            const b = Object.values(state.buildings).filter((x) => x.owner === p);
            return (
              <tr key={p} className={p === state.winner ? 'win' : ''}>
                <td><span className="dot" style={{ background: pl.color }} />{pl.name}</td>
                <td className="num"><strong>{totalVP(state, p)}</strong></td>
                <td className="num">{b.filter((x) => x.kind === 'settlement').length}</td>
                <td className="num">{b.filter((x) => x.kind === 'city').length}</td>
                <td className="num">{pl.devCards.filter((c) => c.kind === 'victory').length}</td>
                <td className="num">{longestRoadOf(state, p)}{state.longestRoad.holder === p ? ' 🛣️' : ''}</td>
                <td className="num">{pl.knights}{state.largestArmy.holder === p ? ' ⚔️' : ''}</td>
                <td className="num">{pl.stats.resourcesGained}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <div className="row end">
        <button type="button" className="btn" onClick={onClose}>Look at the board</button>
        <button type="button" className="btn" onClick={onMenu}>Main menu</button>
        {onNew && <button type="button" className="btn primary" onClick={onNew}>Play again</button>}
      </div>
    </Modal>
  );
}

export function RulesDialog({ onClose, vpToWin = 10 }: { onClose(): void; vpToWin?: number }) {
  return (
    <Modal title="How to play" onClose={onClose} wide>
      <div className="rules">
        <section>
          <h3>Goal</h3>
          <p>Be first to {vpToWin} victory points on your own turn. Settlements are worth 1, cities 2, Longest Road and Largest Army 2 each, and Victory Point cards 1.</p>
        </section>
        <section>
          <h3>Setup</h3>
          <p>Everyone places a settlement and a road, then again in reverse order. Your second settlement earns one card from each hex it touches.</p>
        </section>
        <section>
          <h3>Your turn</h3>
          <p>Roll the dice. Every hex showing that number pays its resource to each settlement (1 card) and city (2 cards) on its corners. Then trade and build in any order, and end your turn.</p>
        </section>
        <section>
          <h3>Building costs</h3>
          <ul className="costlist">
            <li><span>Road</span><CostPips cost={COST.road} /></li>
            <li><span>Settlement</span><CostPips cost={COST.settlement} /></li>
            <li><span>City</span><CostPips cost={COST.city} /></li>
            <li><span>Development card</span><CostPips cost={COST.dev} /></li>
          </ul>
          <p>Settlements need a road of yours leading to them and can't sit next to another building. Cities upgrade your own settlements.</p>
        </section>
        <section>
          <h3>The robber</h3>
          <p>On a 7 nobody collects. Anyone holding more than 7 cards discards half, then the roller moves the robber to a new hex and steals a random card from someone there. The robber's hex produces nothing until it moves.</p>
        </section>
        <section>
          <h3>Trading</h3>
          <p>Trade 4 of one resource for 1 of any other with the bank. A 3:1 harbour lowers that to 3 for anything; a 2:1 harbour to 2 for its resource. You can also offer trades to other players.</p>
        </section>
        <section>
          <h3>Development cards</h3>
          <p><b>Knight</b>: move the robber (3 knights earns Largest Army). <b>Road Building</b>: 2 free roads. <b>Year of Plenty</b>: take 2 resources. <b>Monopoly</b>: take every card of one resource from everyone. <b>Victory Point</b>: 1 hidden point. Play one card per turn, not on the turn you bought it.</p>
        </section>
        <section>
          <h3>Longest Road</h3>
          <p>The first player with an unbroken road of 5 or more gets it, until someone builds a longer one. An opponent's settlement in the middle of a road breaks it.</p>
        </section>
      </div>
    </Modal>
  );
}

export function SettingsDialog({ speed, setSpeed, onClose }: { speed: number; setSpeed(n: number): void; onClose(): void }) {
  const [sfx, setSfx] = useState(sound.sfxVolume);
  const [music, setMusic] = useState(sound.musicVolume);
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings">
        <label htmlFor="set-sfx">Sound effects</label>
        <input id="set-sfx" type="range" min="0" max="1" step="0.05" value={sfx}
          onChange={(e) => { const v = +e.target.value; setSfx(v); sound.unlock(); sound.setVolumes({ sfx: v }); }}
          onMouseUp={() => sound.play('build')} />
        <label htmlFor="set-music">Music</label>
        <input id="set-music" type="range" min="0" max="1" step="0.05" value={music}
          onChange={(e) => { const v = +e.target.value; setMusic(v); sound.unlock(); sound.setVolumes({ music: v }); }} />
        <label htmlFor="set-speed">Computer speed</label>
        <select id="set-speed" value={speed} onChange={(e) => setSpeed(+e.target.value)}>
          <option value={0.6}>Relaxed</option>
          <option value={1}>Normal</option>
          <option value={1.8}>Fast</option>
          <option value={3.5}>Very fast</option>
        </select>
      </div>
    </Modal>
  );
}
