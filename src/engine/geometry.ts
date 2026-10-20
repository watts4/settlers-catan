// Board topology: which corners and sides each hex has, and who touches whom.
// Worked out from the hex list alone, so it never has to be stored. Hexes are
// pointy-top in axial coordinates; positions are for a hex of radius 1.

export interface Point { x: number; y: number }

export interface VertexInfo {
  id: string;
  x: number;
  y: number;
  hexes: number[];   // land hexes touching this corner
  adj: string[];     // neighbouring corners (one road away)
  edges: string[];   // sides that meet here
}

export interface EdgeInfo {
  id: string;
  a: string;         // corner ids
  b: string;
  hexes: number[];   // 1 = coastline, 2 = inland
}

export interface Topology {
  centers: Point[];
  vertices: Record<string, VertexInfo>;
  edges: Record<string, EdgeInfo>;
  vertexIds: string[];
  edgeIds: string[];
  hexCorners: string[][];  // per hex, its 6 corners clockwise from upper right
  hexEdges: string[][];    // per hex, its 6 sides; side i joins corner i and i+1
  coast: string[];         // coastline edges, clockwise from the top
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const SQRT3 = Math.sqrt(3);

export function hexCenter(q: number, r: number): Point {
  return { x: SQRT3 * (q + r / 2), y: 1.5 * r };
}

export function cornerOffset(i: number): Point {
  const a = ((60 * i - 30) * Math.PI) / 180;
  return { x: Math.cos(a), y: Math.sin(a) };
}

const key = (p: Point) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;

const cache = new Map<string, Topology>();

export function topology(hexes: { q: number; r: number }[]): Topology {
  const k = hexes.map((h) => `${h.q},${h.r}`).join(';');
  const hit = cache.get(k);
  if (hit) return hit;

  const centers = hexes.map((h) => hexCenter(h.q, h.r));

  // Collect unique corners by position, then number them top-to-bottom,
  // left-to-right so ids are the same on every machine.
  const pts = new Map<string, Point>();
  centers.forEach((c) => {
    for (let i = 0; i < 6; i++) {
      const o = cornerOffset(i);
      const p = { x: c.x + o.x, y: c.y + o.y };
      pts.set(key(p), p);
    }
  });
  const sorted = [...pts.entries()].sort((a, b) =>
    Math.round(a[1].y * 1000) - Math.round(b[1].y * 1000) || a[1].x - b[1].x);
  const idOf = new Map<string, string>();
  const vertices: Record<string, VertexInfo> = {};
  sorted.forEach(([k2, p], i) => {
    const id = `v${i}`;
    idOf.set(k2, id);
    vertices[id] = { id, x: p.x, y: p.y, hexes: [], adj: [], edges: [] };
  });

  const hexCorners = centers.map((c, hi) => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const o = cornerOffset(i);
      const id = idOf.get(key({ x: c.x + o.x, y: c.y + o.y }))!;
      ids.push(id);
      vertices[id].hexes.push(hi);
    }
    return ids;
  });

  // Sides, numbered by midpoint the same way.
  const sides = new Map<string, { a: string; b: string; mid: Point; hexes: number[] }>();
  hexCorners.forEach((corners, hi) => {
    for (let i = 0; i < 6; i++) {
      const a = corners[i], b = corners[(i + 1) % 6];
      const va = vertices[a], vb = vertices[b];
      const mid = { x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2 };
      const mk = key(mid);
      const s = sides.get(mk);
      if (s) s.hexes.push(hi);
      else sides.set(mk, { a, b, mid, hexes: [hi] });
    }
  });
  const sortedSides = [...sides.entries()].sort((a, b) =>
    Math.round(a[1].mid.y * 1000) - Math.round(b[1].mid.y * 1000) || a[1].mid.x - b[1].mid.x);
  const edges: Record<string, EdgeInfo> = {};
  const edgeOf = new Map<string, string>();
  sortedSides.forEach(([mk, s], i) => {
    const id = `e${i}`;
    edgeOf.set(mk, id);
    edges[id] = { id, a: s.a, b: s.b, hexes: s.hexes };
    vertices[s.a].edges.push(id);
    vertices[s.b].edges.push(id);
    vertices[s.a].adj.push(s.b);
    vertices[s.b].adj.push(s.a);
  });

  const hexEdges = hexCorners.map((corners) => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const va = vertices[corners[i]], vb = vertices[corners[(i + 1) % 6]];
      ids.push(edgeOf.get(key({ x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2 }))!);
    }
    return ids;
  });

  // Coastline in clockwise order starting from straight up.
  const cx = centers.reduce((s, c) => s + c.x, 0) / centers.length;
  const cy = centers.reduce((s, c) => s + c.y, 0) / centers.length;
  const angle = (e: EdgeInfo) => {
    const va = vertices[e.a], vb = vertices[e.b];
    const a = Math.atan2((va.y + vb.y) / 2 - cy, (va.x + vb.x) / 2 - cx) + Math.PI / 2;
    return (a + 2 * Math.PI) % (2 * Math.PI);
  };
  const coast = Object.values(edges).filter((e) => e.hexes.length === 1)
    .sort((a, b) => angle(a) - angle(b)).map((e) => e.id);

  const xs = Object.values(vertices).map((v) => v.x), ys = Object.values(vertices).map((v) => v.y);
  const topo: Topology = {
    centers, vertices, edges,
    vertexIds: sorted.map((_, i) => `v${i}`),
    edgeIds: sortedSides.map((_, i) => `e${i}`),
    hexCorners, hexEdges, coast,
    bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
  };
  cache.set(k, topo);
  return topo;
}

// All axial coordinates within `radius` of the centre, top row first.
export function hexagon(radius: number): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (Math.abs(q + r) <= radius) out.push({ q, r });
    }
  }
  return out;
}

export const NEIGHBOURS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}
