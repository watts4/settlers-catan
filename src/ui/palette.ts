// Colours and names shared by the board art and the panels.

import type { Resource, Terrain } from '../engine/types';

export const TERRAIN_COLOR: Record<Terrain, { base: string; light: string; dark: string }> = {
  wood: { base: '#3d7a3f', light: '#5a9b4e', dark: '#25532b' },
  sheep: { base: '#93c25b', light: '#b4da7a', dark: '#6f9c40' },
  wheat: { base: '#e2b543', light: '#f2d06b', dark: '#b98c26' },
  brick: { base: '#c46a3c', light: '#dc8a58', dark: '#93492a' },
  ore: { base: '#8b929c', light: '#aab1ba', dark: '#5f6670' },
  desert: { base: '#dcc58e', light: '#ecdcab', dark: '#b89e66' },
};

export const RES_COLOR: Record<Resource, string> = {
  wood: '#2f6b35', brick: '#b6542a', sheep: '#86b84c', wheat: '#d9a630', ore: '#6d7580',
};

export const RES_LABEL: Record<Resource, string> = {
  wood: 'Lumber', brick: 'Brick', sheep: 'Wool', wheat: 'Grain', ore: 'Ore',
};
