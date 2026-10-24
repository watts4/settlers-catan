// A small decorative island for the home screen, drawn with the board art.

import { useMemo } from 'react';
import { generateIsland } from '../engine/board';
import { makeRng } from '../engine/rng';
import { topology } from '../engine/geometry';
import { TerrainArt } from './art';
import { TERRAIN_COLOR } from './palette';

const hexPath = (r: number) => Array.from({ length: 6 }, (_, i) => {
  const a = ((60 * i - 30) * Math.PI) / 180;
  return `${(Math.cos(a) * r).toFixed(3)},${(Math.sin(a) * r).toFixed(3)}`;
}).join(' ');

export function HeroIsland() {
  const { hexes } = useMemo(() => generateIsland(makeRng(20261020)), []);
  const topo = topology(hexes);
  const S = 100;
  return (
    <svg className="hero-island" viewBox="-560 -500 1120 1000" aria-hidden="true">
      <defs><clipPath id="heroclip" clipPathUnits="userSpaceOnUse"><polygon points={hexPath(0.95)} /></clipPath></defs>
      <g className="hero-spin">
        {topo.centers.map((c, i) => <polygon key={`s${i}`} points={hexPath(1.12)} transform={`translate(${c.x * S} ${c.y * S}) scale(${S})`} fill="#e6d3a1" />)}
        {hexes.map((h, i) => {
          const c = topo.centers[i];
          return (
            <g key={i} transform={`translate(${c.x * S} ${c.y * S}) scale(${S})`} className="hero-tile" style={{ animationDelay: `${i * 60}ms` }}>
              <polygon points={hexPath(0.96)} fill={TERRAIN_COLOR[h.terrain].base} stroke={TERRAIN_COLOR[h.terrain].dark} strokeWidth="0.03" />
              <g clipPath="url(#heroclip)"><TerrainArt terrain={h.terrain} /></g>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
