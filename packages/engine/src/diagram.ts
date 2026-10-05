import type { Lifecycle } from './templates';

export type Orientation = 'wide' | 'narrow';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaidNode extends Rect {
  id: string;
  label: string;
}

export type Point = [number, number];

export interface LaidEdge {
  /** Position in the lifecycle's edge list; also the number shown on narrow diagrams. */
  index: number;
  from: string;
  to: string;
  label: string;
  points: [Point, Point];
  /** Wide: a text pill beside the line. Narrow: a numbered marker on the line. */
  badge: Rect & { text: string };
}

export interface DiagramLayout {
  orientation: Orientation;
  width: number;
  height: number;
  nodes: LaidNode[];
  edges: LaidEdge[];
}

const PAD = 14;
const CHAR_NODE = 9.5;
const CHAR_LABEL = 7.8;

export function labelWidth(text: string): number {
  return Math.ceil(text.length * CHAR_LABEL + 22);
}

function anchor(rect: Rect, toward: Point): Point {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const scale = Math.min(
    dx === 0 ? Infinity : rect.w / 2 / Math.abs(dx),
    dy === 0 ? Infinity : rect.h / 2 / Math.abs(dy),
  );
  return [cx + dx * scale, cy + dy * scale];
}

export function inflate(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + 2 * by, h: rect.h + 2 * by };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Liang-Barsky: does the segment pass through the (closed) rectangle? */
export function segmentHitsRect(p: Point, q: Point, rect: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const checks: Array<[number, number]> = [
    [-dx, p[0] - rect.x],
    [dx, rect.x + rect.w - p[0]],
    [-dy, p[1] - rect.y],
    [dy, rect.y + rect.h - p[1]],
  ];
  for (const [pk, qk] of checks) {
    if (pk === 0) {
      if (qk < 0) return false;
    } else {
      const r = qk / pk;
      if (pk < 0) {
        if (r > t1) return false;
        t0 = Math.max(t0, r);
      } else {
        if (r < t0) return false;
        t1 = Math.min(t1, r);
      }
    }
  }
  return t0 <= t1;
}

interface Placement {
  rect: Rect;
}

function candidates(
  edge: LaidEdge,
  size: { w: number; h: number },
  mode: Orientation,
): Placement[] {
  const [p, q] = edge.points;
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  const nx = -(q[1] - p[1]) / len;
  const ny = (q[0] - p[0]) / len;
  const out: Placement[] = [];
  for (const t of [0.5, 0.4, 0.6, 0.3, 0.7]) {
    const cx = p[0] + (q[0] - p[0]) * t;
    const cy = p[1] + (q[1] - p[1]) * t;
    if (mode === 'narrow') {
      out.push({ rect: { x: cx - size.w / 2, y: cy - size.h / 2, w: size.w, h: size.h } });
      continue;
    }
    const reach = (Math.abs(nx) * size.w) / 2 + (Math.abs(ny) * size.h) / 2;
    for (const extra of [8, 14, 22, 32, 46, 62]) {
      for (const side of [1, -1]) {
        const d = reach + extra;
        out.push({
          rect: {
            x: cx + nx * side * d - size.w / 2,
            y: cy + ny * side * d - size.h / 2,
            w: size.w,
            h: size.h,
          },
        });
      }
    }
  }
  return out;
}

/**
 * Pixel layout for a lifecycle diagram. Nodes sit on a grid; edges are straight lines between node
 * borders; each edge gets a badge placed where it overlaps no node, no other badge, and (for
 * labels) no line. Wide layouts carry the full label, narrow ones a number that matches the table.
 */
export function layoutDiagram(lifecycle: Lifecycle, orientation: Orientation): DiagramLayout {
  const grid = lifecycle.grid[orientation];
  const longest = Math.max(...lifecycle.nodes.map((n) => n.label.length));
  const wide = orientation === 'wide';
  const nodeW = Math.max(
    wide ? 150 : 112,
    Math.ceil(longest * (wide ? CHAR_NODE : 8.5) + (wide ? 34 : 24)),
  );
  const nodeH = wide ? 52 : 48;
  const widest = Math.max(...lifecycle.edges.map((e) => labelWidth(e.label)));
  const gapX = wide ? Math.max(120, widest + 56) : 44;
  const gapY = wide ? 76 : 66;

  const nodes: LaidNode[] = lifecycle.nodes.map((node) => {
    const [col, row] = grid[node.id] ?? [0, 0];
    return {
      id: node.id,
      label: node.label,
      x: col * (nodeW + gapX),
      y: row * (nodeH + gapY),
      w: nodeW,
      h: nodeH,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const edges: LaidEdge[] = lifecycle.edges.map((edge, index) => {
    const a = byId.get(edge.from) as LaidNode;
    const b = byId.get(edge.to) as LaidNode;
    const ca: Point = [a.x + a.w / 2, a.y + a.h / 2];
    const cb: Point = [b.x + b.w / 2, b.y + b.h / 2];
    return {
      index,
      from: edge.from,
      to: edge.to,
      label: edge.label,
      points: [anchor(a, cb), anchor(b, ca)],
      badge: { x: 0, y: 0, w: 0, h: 0, text: wide ? edge.label : String(index + 1) },
    };
  });

  const placed: Rect[] = [];
  for (const edge of edges) {
    const size = wide ? { w: labelWidth(edge.label), h: 26 } : { w: 26, h: 26 };
    const options = candidates(edge, size, orientation);
    const ok = (rect: Rect): boolean => {
      if (nodes.some((n) => rectsOverlap(inflate(rect, 4), n))) return false;
      if (placed.some((r) => rectsOverlap(inflate(rect, 4), r))) return false;
      return edges.some((other) => {
        if (!wide && other === edge) return false;
        return segmentHitsRect(other.points[0], other.points[1], inflate(rect, wide ? 3 : 0));
      })
        ? false
        : true;
    };
    const chosen = options.find((o) => ok(o.rect)) ?? options[0];
    const rect = (chosen as Placement).rect;
    edge.badge = { ...rect, text: edge.badge.text };
    placed.push(rect);
  }

  const boxes: Rect[] = [...nodes, ...edges.map((e) => e.badge)];
  const minX = Math.min(...boxes.map((r) => r.x)) - PAD;
  const minY = Math.min(...boxes.map((r) => r.y)) - PAD;
  const maxX = Math.max(...boxes.map((r) => r.x + r.w)) + PAD;
  const maxY = Math.max(...boxes.map((r) => r.y + r.h)) + PAD;
  const shift = (r: Rect): Rect => ({ ...r, x: r.x - minX, y: r.y - minY });
  return {
    orientation,
    width: Math.ceil(maxX - minX),
    height: Math.ceil(maxY - minY),
    nodes: nodes.map((n) => ({ ...n, ...shift(n) })),
    edges: edges.map((e) => ({
      ...e,
      points: [
        [e.points[0][0] - minX, e.points[0][1] - minY],
        [e.points[1][0] - minX, e.points[1][1] - minY],
      ],
      badge: { ...e.badge, ...shift(e.badge) },
    })),
  };
}

/** Geometry problems of a layout; empty when nothing overlaps or is crossed. */
export function layoutProblems(layout: DiagramLayout): string[] {
  const problems: string[] = [];
  const wide = layout.orientation === 'wide';
  for (const edge of layout.edges) {
    for (const node of layout.nodes) {
      const touches = node.id === edge.from || node.id === edge.to;
      // Lines may touch their own endpoints; shrink the rectangle so only crossings count.
      const probe = touches ? inflate(node, -2) : node;
      if (segmentHitsRect(edge.points[0], edge.points[1], probe)) {
        problems.push(`edge ${edge.from}->${edge.to} crosses node ${node.id}`);
      }
      if (rectsOverlap(edge.badge, node)) {
        problems.push(`label "${edge.label}" overlaps node ${node.id}`);
      }
    }
    for (const other of layout.edges) {
      if (other === edge) {
        if (wide && segmentHitsRect(...edge.points, edge.badge)) {
          problems.push(`label "${edge.label}" sits on its own line`);
        }
        continue;
      }
      if (rectsOverlap(edge.badge, other.badge)) {
        problems.push(`labels "${edge.label}" and "${other.label}" overlap`);
      }
      if (segmentHitsRect(...other.points, edge.badge)) {
        problems.push(`label "${edge.label}" is crossed by line ${other.from}->${other.to}`);
      }
    }
    if (edge.badge.x < 0 || edge.badge.y < 0 || edge.badge.x + edge.badge.w > layout.width) {
      problems.push(`label "${edge.label}" falls outside the diagram`);
    }
  }
  return problems;
}
