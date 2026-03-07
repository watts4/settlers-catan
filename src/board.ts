// Board generation for Settlers of Catan

import type { Hex, Port, Vertex, Edge, Resource } from './types';

export const HEX_SIZE = 55;

// Standard Catan board layout (19 tiles)
const BOARD_LAYOUT: { resource: Resource; number: number | null }[] = [
  { resource: 'ore', number: 10 },
  { resource: 'wheat', number: 2 },
  { resource: 'wood', number: 9 },
  { resource: 'sheep', number: 12 },
  { resource: 'brick', number: 6 },
  { resource: 'wheat', number: 4 },
  { resource: 'wood', number: 8 },
  { resource: 'desert', number: null },
  { resource: 'sheep', number: 3 },
  { resource: 'ore', number: 11 },
  { resource: 'brick', number: 5 },
  { resource: 'wheat', number: 6 },
  { resource: 'sheep', number: 10 },
  { resource: 'wood', number: 9 },
  { resource: 'ore', number: 3 },
  { resource: 'brick', number: 8 },
  { resource: 'sheep', number: 11 },
  { resource: 'wheat', number: 5 },
  { resource: 'wood', number: 4 },
];

// Proper 3-ring hexagonal board using axial coordinates.
// Constraint: max(|q|, |r|, |q+r|) <= 2 gives exactly 19 hexes in a regular hexagon shape.
// Columns (q from -2 to 2) have 3, 4, 5, 4, 3 hexes respectively.
const HEX_COORDS: { q: number; r: number }[] = [
  // q = -2 (3 hexes): r = 0, 1, 2
  { q: -2, r: 0 }, { q: -2, r: 1 }, { q: -2, r: 2 },
  // q = -1 (4 hexes): r = -1, 0, 1, 2
  { q: -1, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: -1, r: 2 },
  // q =  0 (5 hexes): r = -2, -1, 0, 1, 2
  { q: 0, r: -2 }, { q: 0, r: -1 }, { q: 0, r: 0 }, { q: 0, r: 1 }, { q: 0, r: 2 },
  // q =  1 (4 hexes): r = -2, -1, 0, 1
  { q: 1, r: -2 }, { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 1, r: 1 },
  // q =  2 (3 hexes): r = -2, -1, 0
  { q: 2, r: -2 }, { q: 2, r: -1 }, { q: 2, r: 0 },
];

// Standard 9 Catan ports (5 resource-specific 2:1 + 4 generic 3:1).
// Each port is placed on an OUTER edge of a border hex (the neighbor in that
// direction does not exist in the board).
// Edge→neighbor direction mapping for flat-top axial coords:
//   edge 0 → (+1, 0)   edge 1 → (0, +1)   edge 2 → (-1, +1)
//   edge 3 → (-1, 0)   edge 4 → (0, -1)   edge 5 → (+1, -1)
const PORTS: { q: number; r: number; edge: number; resource: Resource | 'generic' }[] = [
  { q:  0, r: -2, edge: 4, resource: 'generic' }, // top
  { q:  1, r: -2, edge: 5, resource: 'ore'     }, // upper-right
  { q:  2, r: -2, edge: 0, resource: 'generic' }, // right-upper
  { q:  2, r:  0, edge: 0, resource: 'wheat'   }, // right
  { q:  1, r:  1, edge: 1, resource: 'sheep'   }, // lower-right
  { q:  0, r:  2, edge: 1, resource: 'generic' }, // bottom
  { q: -1, r:  2, edge: 2, resource: 'brick'   }, // lower-left
  { q: -2, r:  1, edge: 3, resource: 'generic' }, // left
  { q: -2, r:  0, edge: 4, resource: 'wood'    }, // upper-left
];

// Get pixel center of a hex
export function hexCenterPx(q: number, r: number): { cx: number; cy: number } {
  return {
    cx: HEX_SIZE * 1.5 * q,
    cy: HEX_SIZE * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r),
  };
}

// Get pixel position of a vertex (corner loc 0-5) on a hex
// Flat-top hexes: loc 0 = right, going clockwise
function vertexPx(q: number, r: number, loc: number): { x: number; y: number } {
  const { cx, cy } = hexCenterPx(q, r);
  const angle = (loc * Math.PI) / 3;
  return {
    x: cx + HEX_SIZE * Math.cos(angle),
    y: cy + HEX_SIZE * Math.sin(angle),
  };
}

function posKey(x: number, y: number): string {
  return `${Math.round(x)},${Math.round(y)}`;
}

export function generateBoard(): { hexes: Hex[]; vertices: Vertex[]; edges: Edge[]; ports: Port[] } {
  // Shuffle the layout
  const shuffled = [...BOARD_LAYOUT].sort(() => Math.random() - 0.5);

  // Create hexes
  const hexes: Hex[] = HEX_COORDS.map((coords, i) => ({
    id: `hex-${i}`,
    q: coords.q,
    r: coords.r,
    resource: shuffled[i].resource,
    number: shuffled[i].number,
    hasRobber: shuffled[i].resource === 'desert',
  }));

  // Create vertices (corners of hexes), deduplicated by pixel position
  const vertices: Vertex[] = [];
  const vertexMap = new Map<string, Vertex>();

  hexes.forEach(hex => {
    for (let loc = 0; loc < 6; loc++) {
      const { x, y } = vertexPx(hex.q, hex.r, loc);
      const key = posKey(x, y);

      if (!vertexMap.has(key)) {
        const vertex: Vertex = {
          id: `vertex-${vertices.length}`,
          q: hex.q,
          r: hex.r,
          location: loc,
          x,
          y,
          settlements: {},
        };
        vertices.push(vertex);
        vertexMap.set(key, vertex);
      }
    }
  });

  // Create edges (sides of hexes), deduplicated by midpoint pixel position
  const edges: Edge[] = [];
  const edgeMap = new Map<string, Edge>();

  hexes.forEach(hex => {
    for (let loc = 0; loc < 6; loc++) {
      const { x: x1, y: y1 } = vertexPx(hex.q, hex.r, loc);
      const { x: x2, y: y2 } = vertexPx(hex.q, hex.r, (loc + 1) % 6);
      const key = posKey((x1 + x2) / 2, (y1 + y2) / 2);

      if (!edgeMap.has(key)) {
        const edge: Edge = {
          id: `edge-${edges.length}`,
          q: hex.q,
          r: hex.r,
          location: loc,
          x1, y1, x2, y2,
          roads: {},
        };
        edges.push(edge);
        edgeMap.set(key, edge);
      }
    }
  });

  // Create ports
  const ports: Port[] = PORTS.map((p, i) => ({
    id: `port-${i}`,
    location: { q: p.q, r: p.r, edge: p.edge },
    resource: p.resource,
    ratio: p.resource === 'generic' ? 3 : 2,
  }));

  return { hexes, vertices, edges, ports };
}

// Helper to get hex neighbors
export function getHexNeighbors(hex: Hex, allHexes: Hex[]): Hex[] {
  const directions = [
    { dq: 1, dr: 0 }, { dq: 1, dr: -1 }, { dq: 0, dr: -1 },
    { dq: -1, dr: 0 }, { dq: -1, dr: 1 }, { dq: 0, dr: 1 },
  ];

  return directions
    .map(d => allHexes.find(h => h.q === hex.q + d.dq && h.r === hex.r + d.dr))
    .filter((h): h is Hex => h !== undefined);
}
