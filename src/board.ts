// Board generation for Settlers of Catan

import type { Hex, Port, Vertex, Edge, Resource } from './types';

// Catan board layout (classic 4-player)
const BOARD_LAYOUT: { resource: Resource; number: number | null }[] = [
  { resource: 'ore', number: 10 },
  { resource: 'wheat', number: 2 },
  { resource: 'wood', number: 9 },
  { resource: 'sheep', number: 12 },
  { resource: 'brick', number: 6 },
  { resource: 'wheat', number: 4 },
  { resource: 'wood', number: 8 },
  { resource: 'desert', number: null }, // robber starts here
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

// Axial coordinates for hex grid (q, r)
const HEX_COORDS: { q: number; r: number }[] = [
  { q: -2, r: 0 }, { q: -2, r: 1 }, { q: -1, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: -2 },
  { q: 0, r: -1 }, { q: 0, r: 0 }, { q: 0, r: 1 }, { q: 0, r: 2 }, { q: 1, r: -2 }, { q: 1, r: -1 },
  { q: 1, r: 0 }, { q: 1, r: 1 }, { q: 1, r: 2 }, { q: 2, r: -2 }, { q: 2, r: -1 }, { q: 2, r: 0 },
  { q: 2, r: 1 },
];

// Port locations (edge index on hex, direction)
const PORTS: { q: number; r: number; edge: number; resource: Resource | 'generic' }[] = [
  { q: -2, r: 0, edge: 4, resource: 'wood' },
  { q: -2, r: 1, edge: 5, resource: 'generic' },
  { q: -1, r: -1, edge: 2, resource: 'brick' },
  { q: 0, r: -2, edge: 1, resource: 'sheep' },
  { q: 0, r: 2, edge: 4, resource: 'wheat' },
  { q: 1, r: 2, edge: 0, resource: 'ore' },
  { q: 2, r: -2, edge: 2, resource: 'generic' },
  { q: 2, r: -1, edge: 3, resource: 'wood' },
];

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

  // Create vertices (corners of hexes)
  const vertices: Vertex[] = [];
  const vertexMap = new Map<string, Vertex>();
  
  hexes.forEach(hex => {
    for (let loc = 0; loc < 6; loc++) {
      // Calculate vertex coordinates
      const q = hex.q + Math.floor((loc + 1) / 2) / 3 * 2;
      const r = hex.r + (loc % 3 === 2 ? 1 : 0);
      const key = `${q},${r},${loc}`;
      
      if (!vertexMap.has(key)) {
        const vertex: Vertex = {
          id: `vertex-${vertices.length}`,
          q,
          r,
          location: loc,
          settlements: {},
        };
        vertices.push(vertex);
        vertexMap.set(key, vertex);
      }
    }
  });

  // Create edges (roads/ships)
  const edges: Edge[] = [];
  const edgeMap = new Map<string, Edge>();
  
  hexes.forEach(hex => {
    for (let loc = 0; loc < 6; loc++) {
      const key = `${hex.q},${hex.r},${loc}`;
      
      if (!edgeMap.has(key)) {
        const edge: Edge = {
          id: `edge-${edges.length}`,
          q: hex.q,
          r: hex.r,
          location: loc,
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
    { dq: -1, dr: 0 }, { dq: -1, dr: 1 }, { dq: 0, dr: 1 }
  ];
  
  return directions
    .map(d => allHexes.find(h => h.q === hex.q + d.dq && h.r === hex.r + d.dr))
    .filter((h): h is Hex => h !== undefined);
}

// Get vertices adjacent to a hex
export function getHexVertices(hex: Hex, vertices: Vertex[]): Vertex[] {
  return vertices.filter(v => {
    // Simple check - vertices on this hex have similar q,r
    const dq = Math.abs(v.q - hex.q);
    const dr = Math.abs(v.r - hex.r);
    return dq < 1.5 && dr < 1.5;
  });
}

// Get edges adjacent to a hex
export function getHexEdges(hex: Hex, edges: Edge[]): Edge[] {
  return edges.filter(e => e.q === hex.q && e.r === hex.r);
}
