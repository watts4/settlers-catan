// Hand-drawn SVG art: terrain illustrations for the hex tiles, resource icons
// for cards, and the playing pieces. All drawn from simple shapes so the whole
// board stays crisp at any zoom and costs nothing to load.

import type { ReactElement } from 'react';
import type { Resource, Terrain } from '../engine/types';

// ── terrain art, drawn around a centred number token, hex radius 1 ──────────

function Pine({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0.02" cy="0.17" rx="0.11" ry="0.03" fill="#1b3d20" opacity="0.45" />
      <rect x="-0.018" y="0.08" width="0.036" height="0.09" fill="#5b3a1e" />
      <path d="M0 -0.22 L0.11 -0.04 L0.05 -0.04 L0.14 0.1 L-0.14 0.1 L-0.05 -0.04 L-0.11 -0.04 Z" fill="#1f5a2a" />
      <path d="M0 -0.22 L0.11 -0.04 L0.05 -0.04 L0.14 0.1 L0 0.1 Z" fill="#2f7a37" />
    </g>
  );
}

function Sheep({ x, y, s = 1, flip = false }: { x: number; y: number; s?: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      <ellipse cx="0" cy="0.1" rx="0.13" ry="0.03" fill="#4f7a2c" opacity="0.4" />
      <rect x="-0.07" y="0.02" width="0.022" height="0.08" fill="#3a3330" />
      <rect x="0.05" y="0.02" width="0.022" height="0.08" fill="#3a3330" />
      {[[-0.07, -0.02], [-0.02, -0.05], [0.04, -0.04], [0.08, -0.0], [-0.04, 0.02], [0.03, 0.02]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="0.055" fill="#fbf8ef" />
      ))}
      <ellipse cx="0.14" cy="-0.04" rx="0.045" ry="0.035" fill="#3a3330" />
      <circle cx="0.155" cy="-0.05" r="0.007" fill="#fff" />
    </g>
  );
}

function Tuft({ x, y }: { x: number; y: number }) {
  return <path d={`M${x - 0.04} ${y} q0.02 -0.06 0.03 0 q0.01 -0.08 0.02 0 q0.02 -0.06 0.03 0`} stroke="#5d8f34" strokeWidth="0.014" fill="none" strokeLinecap="round" />;
}

function WheatStalk({ x, y, s = 1, lean = 0 }: { x: number; y: number; s?: number; lean?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${lean}) scale(${s})`}>
      <path d="M0 0.12 L0 -0.08" stroke="#a87d1c" strokeWidth="0.014" />
      {[-0.1, -0.06, -0.02].map((yy, i) => (
        <g key={i}>
          <ellipse cx="-0.022" cy={yy} rx="0.02" ry="0.036" transform={`rotate(-25 -0.022 ${yy})`} fill="#f6d466" stroke="#b78e22" strokeWidth="0.006" />
          <ellipse cx="0.022" cy={yy} rx="0.02" ry="0.036" transform={`rotate(25 0.022 ${yy})`} fill="#f6d466" stroke="#b78e22" strokeWidth="0.006" />
        </g>
      ))}
      <ellipse cx="0" cy="-0.14" rx="0.018" ry="0.034" fill="#f6d466" stroke="#b78e22" strokeWidth="0.006" />
    </g>
  );
}

function Peak({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-0.26 0.14 L0 -0.26 L0.26 0.14 Z" fill="#6c737d" />
      <path d="M0 -0.26 L0.26 0.14 L0.04 0.14 L0.06 0.02 Z" fill="#555c66" />
      <path d="M0 -0.26 L0.09 -0.12 L0.04 -0.09 L0 -0.13 L-0.04 -0.08 L-0.09 -0.12 Z" fill="#f4f6f8" />
    </g>
  );
}

function BrickPile({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  const b = (bx: number, by: number, k: number) => (
    <g key={k}>
      <rect x={bx} y={by} width="0.12" height="0.055" rx="0.008" fill="#a8442a" stroke="#6e2a17" strokeWidth="0.01" />
      <rect x={bx + 0.01} y={by + 0.008} width="0.1" height="0.012" fill="#c9623f" />
    </g>
  );
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0.06" cy="0.12" rx="0.2" ry="0.035" fill="#6e3518" opacity="0.4" />
      {b(-0.12, 0.05, 1)}{b(0.01, 0.05, 2)}{b(0.14, 0.05, 3)}
      {b(-0.055, -0.01, 4)}{b(0.075, -0.01, 5)}
      {b(0.01, -0.07, 6)}
    </g>
  );
}

function Mound({ x, y, w, h, fill }: { x: number; y: number; w: number; h: number; fill: string }) {
  return <path d={`M${x - w} ${y} Q${x} ${y - h * 2} ${x + w} ${y} Z`} fill={fill} />;
}

function Cactus({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill="#5e8a3a" stroke="#3f6526" strokeWidth="0.008">
      <ellipse cx="0" cy="0.12" rx="0.08" ry="0.02" fill="#a88c55" stroke="none" opacity="0.6" />
      <rect x="-0.025" y="-0.14" width="0.05" height="0.26" rx="0.025" />
      <path d="M-0.025 0 h-0.04 a0.02 0.02 0 0 1 -0.02 -0.02 v-0.07 a0.02 0.02 0 0 1 0.04 0 v0.05 h0.02 Z" />
      <path d="M0.025 -0.03 h0.04 a0.02 0.02 0 0 0 0.02 -0.02 v-0.06 a0.02 0.02 0 0 0 -0.04 0 v0.04 h-0.02 Z" />
    </g>
  );
}

export function TerrainArt({ terrain }: { terrain: Terrain }): ReactElement {
  switch (terrain) {
    case 'wood':
      return (
        <g>
          {[[-0.42, -0.5, 1.1], [0.05, -0.68, 1], [0.45, -0.42, 1.15], [-0.66, -0.05, 0.95], [0.66, 0.08, 1], [-0.48, 0.42, 1.1], [0.42, 0.48, 1.05], [-0.02, 0.62, 0.9], [-0.22, -0.72, 0.8], [0.3, -0.75, 0.75]]
            .sort((a, b) => a[1] - b[1])
            .map(([x, y, s], i) => <Pine key={i} x={x} y={y} s={s} />)}
        </g>
      );
    case 'sheep':
      return (
        <g>
          {[[-0.5, -0.45], [0.3, -0.62], [0.62, -0.15], [-0.68, 0.18], [0.5, 0.5], [-0.25, 0.66], [0.05, -0.4], [-0.15, 0.45]].map(([x, y], i) => <Tuft key={i} x={x} y={y} />)}
          <Sheep x={-0.42} y={-0.4} s={1.1} />
          <Sheep x={0.45} y={-0.3} s={1} flip />
          <Sheep x={0.32} y={0.5} s={1.15} flip />
          <Sheep x={-0.48} y={0.38} s={0.95} />
        </g>
      );
    case 'wheat':
      return (
        <g>
          {[-0.62, -0.38, -0.14, 0.1, 0.34, 0.58].map((x, i) => (
            <path key={i} d={`M${x - 0.25} 0.85 L${x + 0.25} -0.85`} stroke="#c99a2e" strokeWidth="0.05" opacity="0.35" />
          ))}
          {[[-0.48, -0.42], [-0.3, -0.5], [0.32, -0.48], [0.5, -0.38], [0.14, -0.62], [-0.62, 0.1], [0.66, 0.12], [-0.4, 0.52], [-0.2, 0.62], [0.36, 0.56], [0.18, 0.66]]
            .map(([x, y], i) => <WheatStalk key={i} x={x} y={y} s={1.05} lean={(i % 3 - 1) * 8} />)}
        </g>
      );
    case 'brick':
      return (
        <g>
          <Mound x={-0.35} y={-0.3} w={0.38} h={0.2} fill="#b35b31" />
          <Mound x={0.3} y={-0.42} w={0.34} h={0.18} fill="#a9532c" />
          <Mound x={0.5} y={0.42} w={0.3} h={0.16} fill="#b35b31" />
          <Mound x={-0.5} y={0.5} w={0.28} h={0.14} fill="#a9532c" />
          <BrickPile x={-0.45} y={0.22} s={1} />
          <BrickPile x={0.36} y={0.12} s={0.9} />
          <BrickPile x={-0.05} y={-0.62} s={0.75} />
        </g>
      );
    case 'ore':
      return (
        <g>
          <Peak x={-0.42} y={-0.36} s={1.2} />
          <Peak x={0.4} y={-0.42} s={1.05} />
          <Peak x={0.05} y={-0.58} s={0.9} />
          <Peak x={-0.5} y={0.48} s={0.95} />
          <Peak x={0.48} y={0.45} s={1.1} />
          {[[-0.12, 0.62], [0.16, 0.7]].map(([x, y], i) => <path key={i} d={`M${x - 0.07} ${y} l0.04 -0.06 l0.06 0.01 l0.04 0.05 Z`} fill="#4c535c" />)}
        </g>
      );
    case 'desert':
      return (
        <g>
          {[-0.5, -0.1, 0.35].map((y, i) => (
            <path key={i} d={`M-0.8 ${y + 0.1} Q-0.3 ${y - 0.12} 0.1 ${y + 0.06} T0.8 ${y}`} stroke="#c2a56a" strokeWidth="0.03" fill="none" opacity="0.7" />
          ))}
          <Cactus x={-0.45} y={-0.38} s={1.2} />
          <Cactus x={0.5} y={0.4} s={1} />
          <circle cx="0.48" cy="-0.5" r="0.06" fill="#f4e6b8" opacity="0.8" />
        </g>
      );
  }
}

// ── resource icons, 100 x 100 viewBox ───────────────────────────────────────

export function ResourceIcon({ res, size = 28 }: { res: Resource; size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      {RES_ICON[res]}
    </svg>
  );
}

// The same icon nested inside another SVG (harbour tokens).
export function ResourceGlyph({ res, x, y, size }: { res: Resource; x: number; y: number; size: number }) {
  return <svg x={x} y={y} width={size} height={size} viewBox="0 0 100 100">{RES_ICON[res]}</svg>;
}

const RES_ICON: Record<Resource, ReactElement> = {
  wood: (
    <g>
      <g transform="rotate(-18 50 50)">
        <rect x="12" y="52" width="70" height="22" rx="11" fill="#8a5a2e" stroke="#4d2f14" strokeWidth="3" />
        <ellipse cx="82" cy="63" rx="7" ry="11" fill="#e2b77a" stroke="#4d2f14" strokeWidth="3" />
        <ellipse cx="82" cy="63" rx="3" ry="5" fill="none" stroke="#a87a43" strokeWidth="2" />
      </g>
      <g transform="rotate(14 50 50)">
        <rect x="16" y="26" width="66" height="22" rx="11" fill="#9b6634" stroke="#4d2f14" strokeWidth="3" />
        <ellipse cx="82" cy="37" rx="7" ry="11" fill="#e8c088" stroke="#4d2f14" strokeWidth="3" />
        <ellipse cx="82" cy="37" rx="3" ry="5" fill="none" stroke="#a87a43" strokeWidth="2" />
      </g>
      <path d="M36 22 q4 -10 12 -8 q-4 4 -2 10 Z" fill="#3e8a3f" />
    </g>
  ),
  brick: (
    <g stroke="#5e2512" strokeWidth="3">
      <rect x="10" y="58" width="38" height="20" rx="3" fill="#b9512b" />
      <rect x="52" y="58" width="38" height="20" rx="3" fill="#c55e33" />
      <rect x="30" y="35" width="40" height="20" rx="3" fill="#cc6a3d" />
      <rect x="40" y="12" width="30" height="20" rx="3" fill="#b9512b" transform="rotate(8 55 22)" />
    </g>
  ),
  sheep: (
    <g>
      <rect x="32" y="66" width="7" height="18" rx="2" fill="#3a3330" />
      <rect x="60" y="66" width="7" height="18" rx="2" fill="#3a3330" />
      {[[30, 50], [42, 40], [56, 40], [68, 50], [38, 60], [60, 60], [50, 52]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="14" fill="#fbf8ef" stroke="#c9c2b0" strokeWidth="2" />
      ))}
      <ellipse cx="80" cy="42" rx="11" ry="9" fill="#3a3330" />
      <circle cx="84" cy="40" r="2" fill="#fff" />
    </g>
  ),
  wheat: (
    <g>
      {[-14, 0, 14].map((rot, k) => (
        <g key={k} transform={`rotate(${rot} 50 88)`}>
          <path d="M50 90 L50 30" stroke="#a87d1c" strokeWidth="3" />
          {[24, 36, 48].map((y, i) => (
            <g key={i}>
              <ellipse cx="44" cy={y} rx="5" ry="9" transform={`rotate(-25 44 ${y})`} fill="#f2cd5c" stroke="#a87d1c" strokeWidth="2" />
              <ellipse cx="56" cy={y} rx="5" ry="9" transform={`rotate(25 56 ${y})`} fill="#f2cd5c" stroke="#a87d1c" strokeWidth="2" />
            </g>
          ))}
          <ellipse cx="50" cy="15" rx="4.5" ry="8" fill="#f2cd5c" stroke="#a87d1c" strokeWidth="2" />
        </g>
      ))}
      <rect x="38" y="62" width="24" height="7" rx="3" fill="#8a5a2e" />
    </g>
  ),
  ore: (
    <g stroke="#2f343b" strokeWidth="3" strokeLinejoin="round">
      <path d="M12 80 L24 48 L46 38 L58 56 L50 82 Z" fill="#7b838e" />
      <path d="M24 48 L46 38 L40 60 Z" fill="#a3abb5" />
      <path d="M48 82 L60 44 L80 34 L92 62 L80 84 Z" fill="#6a727c" />
      <path d="M60 44 L80 34 L74 56 Z" fill="#b8c0ca" />
      <path d="M66 30 l6 -12 l6 12 l-6 6 Z" fill="#9fd0f0" />
    </g>
  ),
};

// ── pieces, drawn around (0,0) in hex units ─────────────────────────────────

export function SettlementShape({ color, scale = 1 }: { color: string; scale?: number }) {
  const s = 0.16 * scale;
  return (
    <g>
      <path d={`M${-s} ${s * 0.9} L${-s} ${-s * 0.15} L0 ${-s * 1.05} L${s} ${-s * 0.15} L${s} ${s * 0.9} Z`}
        fill={color} stroke="#1c1612" strokeWidth={0.022} strokeLinejoin="round" />
      <path d={`M0 ${-s * 1.05} L${s} ${-s * 0.15} L${s} ${s * 0.9} L${s * 0.25} ${s * 0.9} L${s * 0.25} ${-s * 0.3} Z`} fill="#000" opacity="0.18" />
      <rect x={-s * 0.3} y={s * 0.25} width={s * 0.4} height={s * 0.65} fill="#000" opacity="0.28" />
    </g>
  );
}

export function CityShape({ color, scale = 1 }: { color: string; scale?: number }) {
  const s = 0.16 * scale;
  return (
    <g>
      <path d={`M${-s * 1.5} ${s} L${-s * 1.5} ${-s * 0.2} L${-s * 0.75} ${-s * 0.95} L0 ${-s * 0.2} L0 ${-s * 0.5} L${s * 1.5} ${-s * 0.5} L${s * 1.5} ${s} Z`}
        fill={color} stroke="#1c1612" strokeWidth={0.022} strokeLinejoin="round" />
      <path d={`M0 ${-s * 0.5} L${s * 1.5} ${-s * 0.5} L${s * 1.5} ${s} L0 ${s} Z`} fill="#000" opacity="0.15" />
      <rect x={-s * 1.05} y={s * 0.25} width={s * 0.38} height={s * 0.5} fill="#000" opacity="0.28" />
      <rect x={s * 0.35} y={-s * 0.15} width={s * 0.3} height={s * 0.32} fill="#000" opacity="0.25" />
      <rect x={s * 0.9} y={-s * 0.15} width={s * 0.3} height={s * 0.32} fill="#000" opacity="0.25" />
    </g>
  );
}

export function RobberShape() {
  return (
    <g>
      <ellipse cx="0.02" cy="0.2" rx="0.15" ry="0.045" fill="#000" opacity="0.4" />
      <path d="M-0.12 0.2 Q-0.13 0.02 -0.06 -0.05 Q-0.11 -0.12 -0.07 -0.2 Q0 -0.3 0.07 -0.2 Q0.11 -0.12 0.06 -0.05 Q0.13 0.02 0.12 0.2 Z"
        fill="#2b2a2e" stroke="#0d0c0e" strokeWidth="0.018" />
      <path d="M-0.04 -0.24 Q0 -0.29 0.05 -0.23" stroke="#5a5960" strokeWidth="0.02" fill="none" strokeLinecap="round" />
      <path d="M-0.08 0.05 Q-0.02 0.0 0.04 0.18" stroke="#46454b" strokeWidth="0.02" fill="none" />
    </g>
  );
}

export function DevCardArt({ kind, size = 44 }: { kind: string; size?: number }) {
  const icon: Record<string, ReactElement> = {
    knight: (
      <g>
        <path d="M50 14 L78 26 V50 C78 70 62 82 50 88 C38 82 22 70 22 50 V26 Z" fill="#5d6b84" stroke="#232a36" strokeWidth="4" />
        <path d="M50 30 V70 M34 46 H66" stroke="#e6c35c" strokeWidth="7" strokeLinecap="round" />
      </g>
    ),
    victory: (
      <g>
        <path d="M24 70 L30 34 L42 50 L50 24 L58 50 L70 34 L76 70 Z" fill="#e6c35c" stroke="#7a5b12" strokeWidth="4" strokeLinejoin="round" />
        <rect x="22" y="70" width="56" height="10" rx="3" fill="#c9a23c" stroke="#7a5b12" strokeWidth="4" />
      </g>
    ),
    roadBuilding: (
      <g>
        <path d="M18 80 L44 22 M82 80 L56 22" stroke="#6b4a2a" strokeWidth="8" strokeLinecap="round" />
        <path d="M50 76 v-8 M50 56 v-8 M50 36 v-6" stroke="#e6c35c" strokeWidth="6" strokeLinecap="round" />
      </g>
    ),
    yearOfPlenty: (
      <g>
        <path d="M20 40 Q50 96 80 40 Z" fill="#b9853a" stroke="#5e3d14" strokeWidth="4" />
        <circle cx="38" cy="36" r="10" fill="#d9483b" /><circle cx="56" cy="30" r="10" fill="#e6c35c" /><circle cx="66" cy="42" r="8" fill="#6aa84f" />
      </g>
    ),
    monopoly: (
      <g>
        <circle cx="50" cy="50" r="32" fill="#e6c35c" stroke="#7a5b12" strokeWidth="5" />
        <circle cx="50" cy="50" r="22" fill="none" stroke="#7a5b12" strokeWidth="3" />
        <path d="M44 38 h12 a6 6 0 0 1 0 12 h-12 h14 a6 6 0 0 1 0 12 h-14 Z M44 34 v34" stroke="#7a5b12" strokeWidth="4" fill="none" />
      </g>
    ),
  };
  return <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">{icon[kind]}</svg>;
}
