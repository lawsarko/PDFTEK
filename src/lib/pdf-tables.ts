import "server-only";
import type { Line, Run } from "./pdf-layout";

/**
 * Ruled tables: rebuilds a PDF's table grid from its border lines so Word gets a real table with
 * the same rows, columns, merged cells, borders and shading, instead of loose text.
 *
 * PDFs draw borders in many ways: Word exports thin filled rectangles per cell edge (plus tiny
 * squares at the joints), other tools stroke lines or whole cell rectangles. All of them are
 * reduced to horizontal and vertical segments first, then joined into lines.
 */

export type Seg = { x0: number; y0: number; x1: number; y1: number; t: number; color: string };
export type Fill = { x0: number; y0: number; x1: number; y1: number; color: string };
export type Border = { t: number; color: string };

export type TableCell = {
  col: number;
  span: number;
  vMerge?: "restart" | "continue";
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  lines: Line[];
  borders: { top?: Border; bottom?: Border; left?: Border; right?: Border };
  fill?: string;
};
export type TableRow = { y0: number; y1: number; cells: TableCell[] };
export type Table = { x0: number; y0: number; x1: number; y1: number; cols: number[]; rows: TableRow[] };

type HLine = { y: number; x0: number; x1: number; t: number; color: string };
type VLine = { x: number; y0: number; y1: number; t: number; color: string };

const JOIN = 2.5; // gap (pt) still treated as one continuous line
const SNAP = 2; // positions this close are the same grid line

function mergeH(segs: Seg[]): HLine[] {
  const list = segs.map((s) => ({ y: (s.y0 + s.y1) / 2, x0: s.x0, x1: s.x1, t: s.t, color: s.color })).sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const out: HLine[] = [];
  for (const s of list) {
    const g = out.find((o) => Math.abs(o.y - s.y) < 1.2 && s.x0 <= o.x1 + JOIN && s.x1 >= o.x0 - JOIN);
    if (g) {
      g.x0 = Math.min(g.x0, s.x0);
      g.x1 = Math.max(g.x1, s.x1);
      g.t = Math.max(g.t, s.t);
    } else out.push({ ...s });
  }
  return out;
}

function mergeV(segs: Seg[]): VLine[] {
  const list = segs.map((s) => ({ x: (s.x0 + s.x1) / 2, y0: s.y0, y1: s.y1, t: s.t, color: s.color })).sort((a, b) => a.x - b.x || a.y0 - b.y0);
  const out: VLine[] = [];
  for (const s of list) {
    const g = out.find((o) => Math.abs(o.x - s.x) < 1.2 && s.y0 <= o.y1 + JOIN && s.y1 >= o.y0 - JOIN);
    if (g) {
      g.y0 = Math.min(g.y0, s.y0);
      g.y1 = Math.max(g.y1, s.y1);
      g.t = Math.max(g.t, s.t);
    } else out.push({ ...s });
  }
  return out;
}

function cluster(values: number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    if (out.length && v - out[out.length - 1] < SNAP) continue;
    out.push(v);
  }
  return out;
}

/**
 * Finds ruled tables. `toLines` turns a cell's runs into text lines (shared with page layout).
 * Returns the tables and the runs that are not inside any of them.
 */
export function detectTables(hSegs: Seg[], vSegs: Seg[], fills: Fill[], runs: Run[], toLines: (r: Run[]) => Line[]): { tables: Table[]; rest: Run[] } {
  const H = mergeH(hSegs).filter((h) => h.x1 - h.x0 > 4);
  const V = mergeV(vSegs).filter((v) => v.y1 - v.y0 > 4);
  if (H.length < 2 || V.length < 2) return { tables: [], rest: runs };

  // Lines that touch each other belong to the same table.
  const n = H.length + V.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < H.length; i++)
    for (let j = 0; j < V.length; j++) {
      const h = H[i];
      const v = V[j];
      if (h.y >= v.y0 - JOIN && h.y <= v.y1 + JOIN && v.x >= h.x0 - JOIN && v.x <= h.x1 + JOIN) parent[find(i)] = find(H.length + j);
    }
  const groups = new Map<number, { h: HLine[]; v: VLine[] }>();
  H.forEach((h, i) => {
    const g = groups.get(find(i)) ?? { h: [], v: [] };
    g.h.push(h);
    groups.set(find(i), g);
  });
  V.forEach((v, j) => {
    const g = groups.get(find(H.length + j)) ?? { h: [], v: [] };
    g.v.push(v);
    groups.set(find(H.length + j), g);
  });

  const tables: Table[] = [];
  for (const { h, v } of groups.values()) {
    if (h.length < 2 || v.length < 2) continue;
    const xs = cluster(v.map((l) => l.x));
    const ys = cluster(h.map((l) => l.y));
    if (xs.length < 2 || ys.length < 2 || xs.length > 40 || ys.length > 400) continue;
    const x0 = xs[0];
    const x1 = xs[xs.length - 1];
    const y0 = ys[0];
    const y1 = ys[ys.length - 1];
    if (x1 - x0 < 40 || y1 - y0 < 8) continue;

    const hAt = (yi: number, xa: number, xb: number) => {
      const mid = (xa + xb) / 2;
      return h.find((l) => Math.abs(l.y - ys[yi]) < SNAP && l.x0 <= mid && l.x1 >= mid);
    };
    const vAt = (xi: number, ya: number, yb: number) => {
      const mid = (ya + yb) / 2;
      return v.find((l) => Math.abs(l.x - xs[xi]) < SNAP && l.y0 <= mid && l.y1 >= mid);
    };
    const asBorder = (l?: { t: number; color: string }): Border | undefined => (l ? { t: l.t, color: l.color } : undefined);

    const rows: TableRow[] = [];
    for (let r = 0; r < ys.length - 1; r++) {
      const ya = ys[r];
      const yb = ys[r + 1];
      if (yb - ya < 1.5) continue;
      const cells: TableCell[] = [];
      let c = 0;
      while (c < xs.length - 1) {
        let span = 1;
        while (c + span < xs.length - 1 && !vAt(c + span, ya, yb)) span++;
        const xa = xs[c];
        const xb = xs[c + span];
        const cell: TableCell = {
          col: c,
          span,
          x0: xa,
          x1: xb,
          y0: ya,
          y1: yb,
          lines: [],
          borders: { top: asBorder(hAt(r, xa, xb)), bottom: asBorder(hAt(r + 1, xa, xb)), left: asBorder(vAt(c, ya, yb)), right: asBorder(vAt(c + span, ya, yb)) },
        };
        const fill = fills
          .filter((f) => f.x0 <= (xa + xb) / 2 && f.x1 >= (xa + xb) / 2 && f.y0 <= (ya + yb) / 2 && f.y1 >= (ya + yb) / 2)
          .sort((p, q) => (p.x1 - p.x0) * (p.y1 - p.y0) - (q.x1 - q.x0) * (q.y1 - q.y0))[0];
        if (fill && fill.x1 - fill.x0 < (x1 - x0) * 1.05 + 4) cell.fill = fill.color;
        cells.push(cell);
        c += span;
      }
      rows.push({ y0: ya, y1: yb, cells });
    }
    // A missing border between two rows merges those cells vertically.
    for (let r = 1; r < rows.length; r++)
      for (const cell of rows[r].cells) {
        if (cell.borders.top) continue;
        const above = rows[r - 1].cells.find((a) => a.col === cell.col && a.span === cell.span);
        if (!above) continue;
        above.vMerge ??= "restart";
        cell.vMerge = "continue";
      }
    tables.push({ x0, y0, x1, y1, cols: xs, rows });
  }
  if (!tables.length) return { tables, rest: runs };

  // Hand each text run to the cell under it (a merged cell's text goes to its first row).
  const inCell = new Map<TableCell, Run[]>();
  const rest: Run[] = [];
  for (const run of runs) {
    const cx = run.x + Math.max(run.w, 1) / 2;
    const cy = run.y - run.size * 0.3;
    const t = tables.find((tb) => cx >= tb.x0 - 1 && cx <= tb.x1 + 1 && cy >= tb.y0 - 1 && cy <= tb.y1 + 1);
    if (!t) {
      rest.push(run);
      continue;
    }
    const ri = t.rows.findIndex((r) => cy >= r.y0 - 0.5 && cy < r.y1 + 0.5);
    if (ri < 0) continue;
    let cell = t.rows[ri].cells.find((c) => cx >= c.x0 - 0.5 && cx < c.x1 + 0.5);
    if (!cell) continue;
    for (let k = ri; cell.vMerge === "continue" && k > 0; k--) {
      const up: TableCell | undefined = t.rows[k - 1].cells.find((c) => c.col === cell!.col && c.span === cell!.span);
      if (!up) break;
      cell = up;
    }
    const list = inCell.get(cell) ?? [];
    list.push(run);
    inCell.set(cell, list);
  }
  for (const [cell, list] of inCell) cell.lines = toLines(list);
  return { tables, rest };
}
