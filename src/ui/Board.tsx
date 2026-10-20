// The island, drawn in SVG. It shows the state and reports clicks on corners,
// sides and hexes; it never changes the game itself.

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { GameState } from '../engine/types';
import { topology } from '../engine/geometry';
import { PIPS } from '../engine/board';
import { CityShape, ResourceGlyph, RobberShape, SettlementShape, TerrainArt } from './art';
import { TERRAIN_COLOR } from './palette';

const S = 100; // pixels per hex radius in SVG units

export type Pick =
  | { kind: 'vertex'; ids: string[]; piece: 'settlement' | 'city' }
  | { kind: 'edge'; ids: string[] }
  | { kind: 'hex'; ids: number[] }
  | null;

export interface BoardApi {
  hexPoint(h: number): { x: number; y: number } | null;
  vertexPoint(v: string): { x: number; y: number } | null;
  edgePoint(e: string): { x: number; y: number } | null;
}

interface Props {
  state: GameState;
  pick: Pick;
  pickColor: string;
  lit: number | null;          // dice total to glow
  onVertex(v: string): void;
  onEdge(e: string): void;
  onHex(h: number): void;
  odds?: Record<string, number>; // production dots per corner, shown on settlement spots
}

const hexPath = (r: number) => {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 30) * Math.PI) / 180;
    pts.push(`${(Math.cos(a) * r).toFixed(4)},${(Math.sin(a) * r).toFixed(4)}`);
  }
  return pts.join(' ');
};

export const Board = forwardRef<BoardApi, Props>(function Board({ state, pick, pickColor, lit, onVertex, onEdge, onHex, odds }, ref) {
  const topo = topology(state.hexes);
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<string | null>(null);

  // Pieces built after this board appeared get a drop-in animation. The class
  // stays on, which is harmless: CSS animations only run when first applied.
  const [mountSeq] = useState(state.seq);
  const fresh = new Set<string>();
  for (const e of state.events) {
    if (e.kind !== 'build' || e.seq <= mountSeq) continue;
    fresh.add(e.what === 'road' ? e.at : `${e.at}:${e.what}`);
  }

  const toScreen = (x: number, y: number) => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return null;
    const p = el.createSVGPoint();
    p.x = x; p.y = y;
    const q = p.matrixTransform(m);
    return { x: q.x, y: q.y };
  };
  useImperativeHandle(ref, () => ({
    hexPoint: (h) => (topo.centers[h] ? toScreen(topo.centers[h].x * S, topo.centers[h].y * S) : null),
    vertexPoint: (v) => (topo.vertices[v] ? toScreen(topo.vertices[v].x * S, topo.vertices[v].y * S) : null),
    edgePoint: (e) => {
      const ed = topo.edges[e];
      if (!ed) return null;
      const a = topo.vertices[ed.a], b = topo.vertices[ed.b];
      return toScreen(((a.x + b.x) / 2) * S, ((a.y + b.y) / 2) * S);
    },
  }));

  const margin = 1.1;
  const vb = {
    x: (topo.bounds.minX - margin) * S, y: (topo.bounds.minY - margin) * S,
    w: (topo.bounds.maxX - topo.bounds.minX + margin * 2) * S, h: (topo.bounds.maxY - topo.bounds.minY + margin * 2) * S,
  };

  const center = useMemo(() => {
    const c = topo.centers;
    return { x: c.reduce((a, p) => a + p.x, 0) / c.length, y: c.reduce((a, p) => a + p.y, 0) / c.length };
  }, [topo]);

  const ports = state.ports.map((port, i) => {
    const e = topo.edges[port.edge];
    const a = topo.vertices[e.a], b = topo.vertices[e.b];
    const hc = topo.centers[e.hexes[0]];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let dx = mx - hc.x, dy = my - hc.y;
    const len = Math.hypot(dx, dy);
    dx /= len; dy /= len;
    const tx = mx + dx * 0.52, ty = my + dy * 0.52;
    return { i, port, a, b, tx, ty };
  });

  const pickSet = new Set<string | number>(pick?.ids ?? []);
  const robber = topo.centers[state.robber];
  const showTokenRoll = (n: number | null) => lit !== null && n === lit;

  return (
    <svg ref={svg} className="board" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
      role="img" aria-label="Game board">
      <defs>
        <radialGradient id="sea" cx="50%" cy="45%" r="70%">
          <stop offset="0%" stopColor="#2f7fa3" />
          <stop offset="60%" stopColor="#1f5f82" />
          <stop offset="100%" stopColor="#123c57" />
        </radialGradient>
        {Object.entries(TERRAIN_COLOR).map(([t, c]) => (
          <radialGradient key={t} id={`tile-${t}`} cx="45%" cy="40%" r="75%">
            <stop offset="0%" stopColor={c.light} />
            <stop offset="75%" stopColor={c.base} />
            <stop offset="100%" stopColor={c.dark} />
          </radialGradient>
        ))}
        <clipPath id="hexclip" clipPathUnits="userSpaceOnUse"><polygon points={hexPath(0.95)} /></clipPath>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0.02" dy="0.05" stdDeviation="0.03" floodColor="#000" floodOpacity="0.45" />
        </filter>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.06" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <g className="waves" stroke="#8cc7de" strokeWidth="3" fill="none" opacity="0.28" strokeLinecap="round">
        {Array.from({ length: 14 }, (_, i) => {
          const ang = (i / 14) * Math.PI * 2 + 0.3;
          const r = (topo.bounds.maxX - topo.bounds.minX) / 2 + 0.9 + (i % 3) * 0.25;
          const x = (center.x + Math.cos(ang) * r) * S, y = (center.y + Math.sin(ang) * r * 0.92) * S;
          return <path key={i} className={`wave w${i % 3}`} d={`M${x - 26} ${y} q13 -9 26 0 t26 0`} />;
        })}
      </g>

      {/* Sandy shore under the island */}
      <g fill="#e6d3a1" stroke="#d1b97d" strokeWidth="6">
        {topo.centers.map((c, i) => <polygon key={i} points={hexPath(1.13)} transform={`translate(${c.x * S} ${c.y * S}) scale(${S})`} vectorEffect="non-scaling-stroke" />)}
      </g>
      <g fill="#e6d3a1">
        {topo.centers.map((c, i) => <polygon key={i} points={hexPath(1.1)} transform={`translate(${c.x * S} ${c.y * S}) scale(${S})`} />)}
      </g>

      {/* Harbours */}
      {ports.map(({ i, port, a, b, tx, ty }) => (
        <g key={i} className="port">
          <line x1={a.x * S} y1={a.y * S} x2={tx * S} y2={ty * S} stroke="#7a5230" strokeWidth="9" strokeLinecap="round" />
          <line x1={b.x * S} y1={b.y * S} x2={tx * S} y2={ty * S} stroke="#7a5230" strokeWidth="9" strokeLinecap="round" />
          <line x1={a.x * S} y1={a.y * S} x2={tx * S} y2={ty * S} stroke="#a7774a" strokeWidth="4" strokeLinecap="round" strokeDasharray="6 7" />
          <line x1={b.x * S} y1={b.y * S} x2={tx * S} y2={ty * S} stroke="#a7774a" strokeWidth="4" strokeLinecap="round" strokeDasharray="6 7" />
          <circle cx={tx * S} cy={ty * S} r={30} fill="#f4ead2" stroke="#7a5230" strokeWidth="4" />
          {port.kind === 'any' ? (
            <text x={tx * S} y={ty * S + 7} textAnchor="middle" className="port-text">3:1</text>
          ) : (
            <>
              <ResourceGlyph res={port.kind} x={tx * S - 18} y={ty * S - 27} size={36} />
              <text x={tx * S} y={ty * S + 22} textAnchor="middle" className="port-text small">2:1</text>
            </>
          )}
        </g>
      ))}

      {/* Tiles */}
      {state.hexes.map((h, i) => {
        const c = topo.centers[i];
        const hot = h.number === 6 || h.number === 8;
        return (
          <g key={i} transform={`translate(${c.x * S} ${c.y * S}) scale(${S})`} className={`tile ${showTokenRoll(h.number) && i !== state.robber ? 'lit' : ''}`}>
            <polygon points={hexPath(0.97)} fill={`url(#tile-${h.terrain})`} stroke={TERRAIN_COLOR[h.terrain].dark} strokeWidth="0.03" />
            <g clipPath="url(#hexclip)"><TerrainArt terrain={h.terrain} /></g>
            <polygon points={hexPath(0.97)} fill="none" stroke="#fff" strokeOpacity="0.18" strokeWidth="0.02" transform="scale(0.94)" />
            {h.number !== null && (
              <g className="token" filter="url(#shadow)">
                <circle r="0.27" fill="#f4e8c8" stroke="#8b6a3a" strokeWidth="0.02" />
                <circle r="0.23" fill="none" stroke="#d8c49b" strokeWidth="0.01" />
                <text y="0.06" textAnchor="middle" className={`token-num ${hot ? 'hot' : ''}`} style={{ fontSize: h.number >= 10 ? 0.22 : 0.25 }}>{h.number}</text>
                <g fill={hot ? '#b3261e' : '#3a2a1a'}>
                  {Array.from({ length: PIPS[h.number] }, (_, k) => (
                    <circle key={k} cx={(k - (PIPS[h.number!] - 1) / 2) * 0.05} cy="0.15" r="0.017" />
                  ))}
                </g>
              </g>
            )}
          </g>
        );
      })}

      {/* Robber targets */}
      {pick?.kind === 'hex' && state.hexes.map((_, i) => {
        const c = topo.centers[i];
        const ok = pickSet.has(i);
        return (
          <polygon key={`rh${i}`} points={hexPath(0.95)} transform={`translate(${c.x * S} ${c.y * S}) scale(${S})`}
            className={ok ? 'hex-target' : 'hex-dim'} onClick={ok ? () => onHex(i) : undefined}
            onMouseEnter={() => ok && setHover(`h${i}`)} onMouseLeave={() => setHover(null)} />
        );
      })}

      {/* Roads */}
      {Object.entries(state.roads).map(([e, owner]) => {
        const ed = topo.edges[e];
        const a = topo.vertices[ed.a], b = topo.vertices[ed.b];
        const k = 0.2;
        const x1 = (a.x + (b.x - a.x) * k) * S, y1 = (a.y + (b.y - a.y) * k) * S;
        const x2 = (b.x + (a.x - b.x) * k) * S, y2 = (b.y + (a.y - b.y) * k) * S;
        return (
          <g key={e} className={`road ${fresh.has(e) ? 'drop' : ''}`} style={{ transformOrigin: `${(x1 + x2) / 2}px ${(y1 + y2) / 2}px` }}>
            <line x1={x1} y1={y1 + 4} x2={x2} y2={y2 + 4} stroke="#000" strokeOpacity="0.35" strokeWidth="17" strokeLinecap="round" />
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1c1612" strokeWidth="17" strokeLinecap="round" />
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={state.players[owner].color} strokeWidth="11" strokeLinecap="round" />
            <line x1={x1} y1={y1 - 2} x2={x2} y2={y2 - 2} stroke="#fff" strokeOpacity="0.25" strokeWidth="3" strokeLinecap="round" />
          </g>
        );
      })}

      {/* Edge targets */}
      {pick?.kind === 'edge' && pick.ids.map((e) => {
        const ed = topo.edges[e];
        const a = topo.vertices[ed.a], b = topo.vertices[ed.b];
        const k = 0.2;
        const x1 = (a.x + (b.x - a.x) * k) * S, y1 = (a.y + (b.y - a.y) * k) * S;
        const x2 = (b.x + (a.x - b.x) * k) * S, y2 = (b.y + (a.y - b.y) * k) * S;
        const isHover = hover === e;
        return (
          <g key={`t${e}`} className="edge-target" onClick={() => onEdge(e)} onMouseEnter={() => setHover(e)} onMouseLeave={() => setHover(null)}>
            {isHover ? (
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={pickColor} strokeOpacity="0.75" strokeWidth="12" strokeLinecap="round" />
            ) : (
              <line x1={x1} y1={y1} x2={x2} y2={y2} className="edge-hint" stroke={pickColor} strokeWidth="10" strokeLinecap="round" />
            )}
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="30" strokeLinecap="round" />
          </g>
        );
      })}

      {/* Buildings */}
      {Object.entries(state.buildings).map(([v, b]) => {
        const vx = topo.vertices[v];
        const id = `${v}:${b.kind}`;
        return (
          <g key={id} transform={`translate(${vx.x * S} ${vx.y * S}) scale(${S})`}>
            <g className={`piece ${fresh.has(id) ? 'drop' : ''}`} filter="url(#shadow)">
              {b.kind === 'city' ? <CityShape color={state.players[b.owner].color} /> : <SettlementShape color={state.players[b.owner].color} />}
            </g>
          </g>
        );
      })}

      {/* Vertex targets */}
      {pick?.kind === 'vertex' && pick.ids.map((v) => {
        const vx = topo.vertices[v];
        const isHover = hover === v;
        return (
          <g key={`t${v}`} transform={`translate(${vx.x * S} ${vx.y * S}) scale(${S})`} className="vertex-target"
            onClick={() => onVertex(v)} onMouseEnter={() => setHover(v)} onMouseLeave={() => setHover(null)}>
            {isHover ? (
              <g opacity="0.8">{pick.piece === 'city' ? <CityShape color={pickColor} /> : <SettlementShape color={pickColor} />}</g>
            ) : odds ? (
              <g className="odds-hint">
                <circle r="0.13" style={{ stroke: pickColor }} />
                <text y="0.045" textAnchor="middle">{odds[v]}</text>
              </g>
            ) : (
              <circle r="0.1" className="vertex-hint" style={{ stroke: pickColor }} />
            )}
            <circle r="0.22" fill="transparent" />
          </g>
        );
      })}

      {/* Robber */}
      <g className="robber" style={{ transform: `translate(${robber.x * S - 42}px, ${robber.y * S - 8}px)` }}>
        <g transform={`scale(${S})`} filter="url(#shadow)"><RobberShape /></g>
      </g>
      {hover?.startsWith('h') && (
        <g style={{ transform: `translate(${topo.centers[+hover.slice(1)].x * S - 42}px, ${topo.centers[+hover.slice(1)].y * S - 8}px)` }} opacity="0.55" pointerEvents="none">
          <g transform={`scale(${S})`}><RobberShape /></g>
        </g>
      )}
    </svg>
  );
});
