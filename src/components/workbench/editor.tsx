"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PageViewport } from "pdfjs-dist";
import { BlendMode, LineCapStyle, LineJoinStyle, PDFDocument, StandardFonts, popGraphicsState, pushGraphicsState, rgb, setLineJoin, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { cssStack, isSerif } from "@/lib/font-names";
import { api, errMsg } from "@/lib/client/api";
import type { Doc } from "@/lib/client/types";
import { loadPdf, pageToCanvas, textRuns, type TextRun } from "@/lib/client/pdf";
import { toJpeg } from "@/lib/client/images";
import { PdfViewer, type PageInfo } from "../pdf-viewer";
import { I } from "../icons";
import { useToast } from "../toast";

type Style = { size: number; bold: boolean; italic: boolean; underline: boolean; serif: boolean; color: string; /** Real font family (e.g. "EB Garamond"); serif/sans fallback when absent. */ family?: string };
type TextOp = {
  id: string;
  type: "text" | "replace";
  page: number;
  x: number;
  y: number;
  text: string;
  /** Replace ops: the original segment's text, width and glyph extents (for the cover-up box). */
  original?: string;
  ow?: number;
  ascent?: number;
  descent?: number;
  origFamily?: string;
} & Style;
type ImageOp = { id: string; type: "image"; page: number; x: number; y: number; w: number; h: number; dataUrl: string };
type RectOp = { id: string; type: "highlight" | "whiteout" | "redact"; page: number; x: number; y: number; w: number; h: number };
/** Text markup. Each rect covers one line of the marked text: [x, y, w, h], y = bottom of the glyphs. */
type MarkOp = { id: string; type: "mark"; kind: MarkKind; page: number; rects: [number, number, number, number][]; color: string };
/** Freehand pen or highlighter stroke, in PDF points. */
type InkOp = { id: string; type: "ink"; page: number; points: [number, number][]; color: string; width: number; opacity: number };
/** Shapes are kept as their two defining corners (or a line's two ends). */
type ShapeOp = { id: string; type: "shape"; kind: ShapeKind; page: number; x1: number; y1: number; x2: number; y2: number; color: string; width: number };
type Op = TextOp | ImageOp | RectOp | MarkOp | InkOp | ShapeOp;
type MarkKind = "highlight" | "underline" | "strike" | "squiggle";
type InkKind = "pencil" | "highlighter" | "eraser";
type ShapeKind = "rect" | "ellipse" | "check" | "cross" | "line" | "arrow";
type Tool = "select" | "text" | "image" | "mark" | "ink" | "shape" | "whiteout" | "redact";

/** "highlight" rects come from drafts saved before text markup existed. */
const isRect = (o: Op): o is RectOp => o.type === "highlight" || o.type === "whiteout" || o.type === "redact";
const isDrawn = (o: Op): o is MarkOp | InkOp | ShapeOp => o.type === "mark" || o.type === "ink" || o.type === "shape";

const MARKS: [MarkKind, string, React.ReactNode][] = [
  ["highlight", "Highlight", <I.highlight key="i" size={14} />],
  ["underline", "Underline", <I.underline key="i" size={14} />],
  ["strike", "Strikethrough", <I.strike key="i" size={14} />],
  ["squiggle", "Squiggle", <I.squiggle key="i" size={14} />],
];
const INKS: [InkKind, string, React.ReactNode][] = [
  ["pencil", "Pencil", <I.pencil key="i" size={14} />],
  ["highlighter", "Highlighter", <I.marker key="i" size={14} />],
  ["eraser", "Eraser", <I.eraser key="i" size={14} />],
];
const SHAPES: [ShapeKind, string, React.ReactNode][] = [
  ["rect", "Rectangle", <I.square key="i" size={14} />],
  ["ellipse", "Circle", <I.circle key="i" size={14} />],
  ["check", "Checkmark", <I.check key="i" size={14} />],
  ["cross", "Cross", <I.x key="i" size={14} />],
  ["line", "Line", <I.line key="i" size={14} />],
  ["arrow", "Arrow", <I.arrow key="i" size={14} />],
];
/** Starting colour for each kind of mark; people can change it in the toolbar. */
const PEN_DEFAULT: Record<string, { color: string; width: number }> = {
  highlight: { color: "#ffd400", width: 0 },
  underline: { color: "#e5484d", width: 0 },
  strike: { color: "#e5484d", width: 0 },
  squiggle: { color: "#e5484d", width: 0 },
  pencil: { color: "#1d4ed8", width: 2 },
  highlighter: { color: "#ffd400", width: 12 },
  eraser: { color: "#000000", width: 0 },
  shape: { color: "#e5484d", width: 2 },
};
type Pen = { color: string; width: number };
/** Thickness choices, in points, for tools that have one. */
const WIDTHS: Record<string, number[] | undefined> = { pencil: [1, 2, 3, 5, 8], highlighter: [8, 12, 18, 24], shape: [1, 2, 3, 5] };
const uid = () => Math.random().toString(36).slice(2, 10);
const DEFAULT_STYLE: Style = { size: 11, bold: false, italic: false, underline: false, serif: false, color: "#111111" };
const TEXT_COLOR = "#171717";
const FONT_CHOICES = ["Arial", "Calibri", "Times New Roman", "Georgia", "Garamond", "EB Garamond", "Cambria"];

/** Box that hides the original text of a replaced segment (PDF units, bottom-left origin). */
function coverRect(op: { x: number; y: number; size: number; ow?: number; ascent?: number; descent?: number }) {
  const asc = op.ascent ?? 0.9;
  const desc = op.descent ?? -0.25;
  const bottom = op.y + desc * op.size * 1.15 - 0.6;
  const top = op.y + asc * op.size + 0.6;
  return { x: op.x - 1.2, y: bottom, w: (op.ow ?? 0) + 2.4, h: top - bottom };
}

// ---------- markup, drawings and shapes: one geometry for the screen and the saved PDF ----------

type Pt = [number, number];
/** A drawn op as plain paths in PDF points. `fill` paths are closed areas; the rest are strokes. */
type Geometry = { paths: { pts: Pt[]; closed: boolean; fill: boolean }[]; width: number; color: string; opacity: number; multiply: boolean };

function markLines(kind: MarkKind, [x, y, w, h]: [number, number, number, number]): { pts: Pt[]; closed: boolean; fill: boolean } {
  if (kind === "highlight") return { pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true, fill: true };
  if (kind === "underline") return { pts: [[x, y + h * 0.12], [x + w, y + h * 0.12]], closed: false, fill: false };
  if (kind === "strike") return { pts: [[x, y + h * 0.42], [x + w, y + h * 0.42]], closed: false, fill: false };
  // Squiggle: a gentle wave just under the text.
  const amp = Math.max(0.8, h * 0.05);
  const len = Math.max(3, h * 0.28);
  const pts: Pt[] = [];
  for (let t = 0; t <= w; t += len / 8) pts.push([x + t, y + h * 0.08 + Math.sin((t / len) * Math.PI * 2) * amp]);
  return { pts, closed: false, fill: false };
}

function geometry(op: MarkOp | InkOp | ShapeOp): Geometry {
  if (op.type === "mark") {
    const thick = Math.max(0.75, Math.min(2, (op.rects[0]?.[3] ?? 10) * 0.07));
    return { paths: op.rects.map((r) => markLines(op.kind, r)), width: op.kind === "highlight" ? 0 : thick, color: op.color, opacity: op.kind === "highlight" ? 0.4 : 1, multiply: op.kind === "highlight" };
  }
  if (op.type === "ink") return { paths: [{ pts: op.points, closed: false, fill: false }], width: op.width, color: op.color, opacity: op.opacity, multiply: op.opacity < 1 };
  const { x1, y1, x2, y2 } = op;
  const [l, r, b, t] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
  const [w, h] = [r - l, t - b];
  const base = { width: op.width, color: op.color, opacity: 1, multiply: false };
  const open = (pts: Pt[]) => ({ pts, closed: false, fill: false });
  switch (op.kind) {
    case "rect":
      return { ...base, paths: [{ pts: [[l, b], [r, b], [r, t], [l, t]], closed: true, fill: false }] };
    case "ellipse": {
      const pts: Pt[] = [];
      for (let i = 0; i < 72; i++) pts.push([l + w / 2 + (w / 2) * Math.cos((i / 72) * Math.PI * 2), b + h / 2 + (h / 2) * Math.sin((i / 72) * Math.PI * 2)]);
      return { ...base, paths: [{ pts, closed: true, fill: false }] };
    }
    case "check":
      return { ...base, paths: [open([[l + w * 0.1, b + h * 0.5], [l + w * 0.38, b + h * 0.15], [l + w * 0.92, b + h * 0.88]])] };
    case "cross":
      return { ...base, paths: [open([[l + w * 0.12, b + h * 0.12], [r - w * 0.12, t - h * 0.12]]), open([[l + w * 0.12, t - h * 0.12], [r - w * 0.12, b + h * 0.12]])] };
    case "line":
      return { ...base, paths: [open([[x1, y1], [x2, y2]])] };
    case "arrow": {
      const a = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.min(Math.hypot(x2 - x1, y2 - y1) * 0.45, 6 + op.width * 3);
      const wing = (d: number): Pt => [x2 - head * Math.cos(a + d), y2 - head * Math.sin(a + d)];
      return { ...base, paths: [open([[x1, y1], [x2, y2]]), open([wing(0.45), [x2, y2], wing(-0.45)])] };
    }
  }
}

/** Distance from p to segment ab. */
function segDist(p: Pt, a: Pt, b: Pt) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Whether a PDF-space point touches the op, within `tol` points of a stroke. */
function hits(op: MarkOp | InkOp | ShapeOp, p: Pt, tol: number) {
  if (op.type === "mark") return op.rects.some(([x, y, w, h]) => p[0] >= x - tol && p[0] <= x + w + tol && p[1] >= y - tol && p[1] <= y + h + tol);
  const g = geometry(op);
  const reach = tol + g.width / 2;
  return g.paths.some(({ pts, closed }) => {
    if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) <= reach;
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) if (segDist(p, pts[i], pts[(i + 1) % pts.length]) <= reach) return true;
    return false;
  });
}

function bounds(op: MarkOp | InkOp | ShapeOp): [number, number, number, number] {
  const pts = geometry(op).paths.flatMap((p) => p.pts);
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function translate(op: MarkOp | InkOp | ShapeOp, dx: number, dy: number): Op {
  if (op.type === "mark") return { ...op, rects: op.rects.map(([x, y, w, h]) => [x + dx, y + dy, w, h]) };
  if (op.type === "ink") return { ...op, points: op.points.map(([x, y]) => [x + dx, y + dy]) };
  return { ...op, x1: op.x1 + dx, y1: op.y1 + dy, x2: op.x2 + dx, y2: op.y2 + dy };
}

/**
 * Text under a drag from `a` to `b` (PDF points), the way a text selection works: from the start
 * point to the end of its line, whole lines in between, and the last line up to the end point.
 * Returns one rect per line.
 */
function textUnder(runs: TextRun[], a: Pt, b: Pt): [number, number, number, number][] {
  const box = (r: TextRun) => ({ l: r.x, r: r.x + r.w, b: r.y + Math.min(-0.15, r.descent) * r.size, t: r.y + Math.max(0.6, r.ascent) * r.size });
  const inBand = (r: TextRun, y: number) => {
    const k = box(r);
    return y >= k.b && y <= k.t;
  };
  // Reading order: the start is the higher point (or the left one on the same line).
  const sameLine = runs.some((r) => inBand(r, a[1]) && inBand(r, b[1])) || Math.abs(a[1] - b[1]) < 2;
  const [s, e] = sameLine ? (a[0] <= b[0] ? [a, b] : [b, a]) : a[1] > b[1] ? [a, b] : [b, a];
  // Snap a cut inside a run to the nearest character boundary.
  const snap = (r: TextRun, x: number) => {
    const n = Math.max(1, r.str.length);
    const cw = r.w / n;
    return r.x + Math.max(0, Math.min(n, Math.round((x - r.x) / cw))) * cw;
  };
  const lines = new Map<number, { l: number; r: number; b: number; t: number }>();
  for (const r of runs) {
    if (!r.str.trim()) continue;
    const k = box(r);
    const mid = (k.b + k.t) / 2;
    const first = inBand(r, s[1]) || (sameLine && Math.abs(mid - s[1]) < r.size);
    const last = inBand(r, e[1]) || (sameLine && Math.abs(mid - e[1]) < r.size);
    if (!first && !last && !(mid < s[1] && mid > e[1])) continue;
    let l = k.l;
    let rr = k.r;
    if (first) l = Math.max(l, snap(r, s[0]));
    if (last) rr = Math.min(rr, snap(r, e[0]));
    if (sameLine && !(first && last)) continue;
    if (rr - l < 0.5) continue;
    const key = Math.round(r.y);
    const cur = lines.get(key);
    lines.set(key, cur ? { l: Math.min(cur.l, l), r: Math.max(cur.r, rr), b: Math.min(cur.b, k.b), t: Math.max(cur.t, k.t) } : { l, r: rr, b: k.b, t: k.t });
  }
  return [...lines.values()].sort((p, q) => q.b - p.b).map((k) => [k.l, k.b, k.r - k.l, k.t - k.b]);
}

// ---------- fonts: the document's own typeface, fetched once per face ----------

const fontBytes = new Map<string, Promise<ArrayBuffer | null>>();
function loadFontBytes(family: string, bold: boolean, italic: boolean): Promise<ArrayBuffer | null> {
  const key = `${family}|${bold ? 1 : 0}|${italic ? 1 : 0}`;
  let p = fontBytes.get(key);
  if (!p) {
    p = fetch(`/api/fonts?family=${encodeURIComponent(family)}&bold=${bold ? 1 : 0}&italic=${italic ? 1 : 0}`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    fontBytes.set(key, p);
    // Register for on-screen previews under the document's family name.
    p.then((buf) => {
      if (!buf || typeof FontFace === "undefined") return;
      const face = new FontFace(family, buf.slice(0), { weight: bold ? "700" : "400", style: italic ? "italic" : "normal" });
      face.load().then((f) => document.fonts.add(f)).catch(() => {});
    });
  }
  return p;
}

export function Editor({ doc, onExit }: { doc: Doc; onExit: (saved: Doc | null) => void }) {
  const toast = useToast();
  const src = `/api/documents/${doc.id}/file?version=${doc.versionId}`;
  const [ops, setOps] = useState<Op[]>([]);
  const [undo, setUndo] = useState<Op[][]>([]);
  const [redo, setRedo] = useState<Op[][]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [markKind, setMarkKind] = useState<MarkKind>("highlight");
  const [inkKind, setInkKind] = useState<InkKind>("pencil");
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect");
  const [pens, setPens] = useState<Record<string, Pen>>(PEN_DEFAULT);
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE);
  const [selected, setSelected] = useState<string | null>(null);
  const [scale, setScale] = useState(1.3);
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [autoLocked, setAutoLocked] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  // Take the edit lock and restore any autosaved draft.
  useEffect(() => {
    (async () => {
      if (!doc.checkedOutBy) {
        try {
          await api(`/api/documents/${doc.id}/checkout`, { method: "POST", json: { action: "checkout" } });
          setAutoLocked(true);
        } catch (e) {
          toast(errMsg(e), "error");
          onExit(null);
          return;
        }
      }
      const r = await api<{ draft: { ops: Op[]; versionId: string; savedAt: number } | null }>(`/api/documents/${doc.id}/draft`).catch(() => ({ draft: null }));
      if (r.draft?.ops?.length && r.draft.versionId === doc.versionId) {
        setOps(r.draft.ops);
        setSavedAt(r.draft.savedAt);
        toast(`Restored ${r.draft.ops.length} unsaved change${r.draft.ops.length > 1 ? "s" : ""}`);
      }
      loaded.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave the draft (debounced).
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(async () => {
      try {
        await fetch(`/api/documents/${doc.id}/draft`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(ops.length ? { ops, versionId: doc.versionId } : null),
        });
        setSavedAt(Date.now());
      } catch {}
    }, 1200);
    return () => clearTimeout(t);
  }, [ops, doc.id, doc.versionId]);

  const commit = useCallback((next: Op[] | ((o: Op[]) => Op[])) => {
    setOps((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      setUndo((u) => [...u.slice(-80), prev]);
      setRedo([]);
      return value;
    });
  }, []);

  const doUndo = useCallback(() => {
    setUndo((u) => {
      if (!u.length) return u;
      setOps((cur) => {
        setRedo((r) => [...r, cur]);
        return u[u.length - 1];
      });
      return u.slice(0, -1);
    });
  }, []);
  const doRedo = useCallback(() => {
    setRedo((r) => {
      if (!r.length) return r;
      setOps((cur) => {
        setUndo((u) => [...u, cur]);
        return r[r.length - 1];
      });
      return r.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        commit((o) => o.filter((x) => x.id !== selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo, selected, commit]);

  // Apply style toolbar changes to the selected text op.
  const applyStyle = (patch: Partial<Style>) => {
    setStyle((s) => ({ ...s, ...patch }));
    const op = ops.find((o) => o.id === selected);
    if (op && (op.type === "text" || op.type === "replace")) commit((list) => list.map((o) => (o.id === op.id ? ({ ...o, ...patch } as Op) : o)));
  };

  const pickImage = async (f: File) => {
    try {
      const j = await toJpeg(f, { maxEdge: 1800 });
      const blob = new Blob([j.bytes as BlobPart], { type: "image/jpeg" });
      const dataUrl = await new Promise<string>((r) => {
        const fr = new FileReader();
        fr.onload = () => r(fr.result as string);
        fr.readAsDataURL(blob);
      });
      setPendingImage({ dataUrl, w: j.width, h: j.height });
      setTool("image");
      toast("Click on a page to place the image");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const exit = async (saved: Doc | null) => {
    if (!saved && ops.length && !confirm("Leave the editor? Your changes stay saved as a draft for next time.")) return;
    if (autoLocked) await api(`/api/documents/${doc.id}/checkout`, { method: "POST", json: { action: "checkin" } }).catch(() => {});
    onExit(saved);
  };

  const save = async () => {
    if (!ops.length) return exit(null);
    setSaving(true);
    try {
      let bytes: Uint8Array;
      try {
        bytes = await buildPdf(src, ops);
      } catch (err) {
        // Never lose an edit over a font problem: retry with the closest standard font.
        console.warn("[pdftek] saving with the document's font failed; using a standard font", err);
        bytes = await buildPdf(src, ops, true);
        toast("Saved. The original font couldn't be embedded, so a similar standard font was used.", "info");
      }
      const form = new FormData();
      form.append("file", new File([bytes as BlobPart], doc.name, { type: "application/pdf" }));
      form.append("kind", "edit");
      const counts = ops.reduce<Record<string, number>>((m, o) => ((m[o.type] = (m[o.type] ?? 0) + 1), m), {});
      const label: Record<string, string> = { replace: "text edit", text: "text box", image: "image", highlight: "highlight", whiteout: "whiteout", redact: "redaction", mark: "markup", ink: "drawing", shape: "shape" };
      form.append("note", Object.entries(counts).map(([k, n]) => `${n} ${label[k]}${n > 1 ? "s" : ""}`).join(", "));
      const r = await api<{ document: Doc }>(`/api/documents/${doc.id}/versions`, { method: "POST", body: form });
      await fetch(`/api/documents/${doc.id}/draft`, { method: "PUT", headers: { "content-type": "application/json" }, body: "null" });
      toast("Saved as a new version", "success");
      setOps([]);
      await exit(r.document);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const sel = ops.find((o) => o.id === selected);
  const shownStyle = sel && (sel.type === "text" || sel.type === "replace") ? sel : style;
  const penKey = tool === "mark" ? markKind : tool === "ink" ? inkKind : tool === "shape" ? "shape" : sel?.type === "mark" ? sel.kind : sel?.type === "ink" ? (sel.opacity < 1 ? "highlighter" : "pencil") : sel?.type === "shape" ? "shape" : null;
  const selDrawn = sel && isDrawn(sel) ? sel : null;
  const pen: Pen = selDrawn ? { color: selDrawn.color, width: selDrawn.type === "mark" ? 0 : selDrawn.width } : penKey ? pens[penKey] : { color: "#000000", width: 0 };
  // Pen changes apply to the next mark and to the selected one.
  const applyPen = (patch: Partial<Pen>) => {
    if (penKey) setPens((p) => ({ ...p, [penKey]: { ...p[penKey], ...patch } }));
    if (selDrawn) commit((list) => list.map((o) => (o.id === selDrawn.id && isDrawn(o) ? ({ ...o, color: patch.color ?? o.color, ...(o.type !== "mark" && patch.width ? { width: patch.width } : {}) } as Op) : o)));
  };
  const pick = (t: Tool) => {
    setTool(t);
    setSelected(null);
  };
  const tools: [Tool, React.ReactNode, string][] = [
    ["select", <I.edit key="i" size={13} />, "Edit text"],
    ["text", <I.text key="i" size={13} />, "Add text"],
    ["image", <I.image key="i" size={13} />, "Image"],
  ];
  const hint: Partial<Record<Tool, string>> = {
    select: "Click any text to change it. Click a mark or drawing to move, recolour or delete it.",
    text: "Click anywhere on the page, type, then press Enter.",
    mark: "Drag across text to mark it. Works like selecting text.",
    ink: inkKind === "eraser" ? "Drag over drawings, marks or shapes to erase them." : "Draw on the page with your mouse, pen or finger.",
    shape: shapeKind === "check" || shapeKind === "cross" ? "Click to stamp, or drag to size it." : "Drag on the page to draw. Hold Shift to keep it even.",
  };

  return (
    <>
      <div className="viewer-toolbar">
        <div className="grow">
          <div className="viewer-title ellipsis">Editing · {doc.name}</div>
          <div className="tiny mono faint">
            {ops.length} change{ops.length === 1 ? "" : "s"} · {savedAt ? "draft autosaved" : "autosave on"} · you hold the edit lock
          </div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={() => exit(null)}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
          {saving && <span className="spinner" />} {ops.length ? "Save version" : "Done"}
        </button>
      </div>
      <div className="edit-toolbar">
        {tools.map(([t, icon, label]) => (
          <button
            key={t}
            className={`tool-btn ${tool === t ? "active" : ""}`}
            onClick={() => {
              if (t === "image") imageInput.current?.click();
              else pick(t);
            }}
          >
            {icon} {label}
          </button>
        ))}
        <ToolMenu label="Highlight" items={MARKS} active={tool === "mark"} current={markKind} onPick={(k) => { setMarkKind(k); pick("mark"); }} />
        <ToolMenu label="Draw" items={INKS} active={tool === "ink"} current={inkKind} onPick={(k) => { setInkKind(k); pick("ink"); }} />
        <ToolMenu label="Shape" items={SHAPES} active={tool === "shape"} current={shapeKind} onPick={(k) => { setShapeKind(k); pick("shape"); }} />
        <button className={`tool-btn ${tool === "whiteout" ? "active" : ""}`} onClick={() => pick("whiteout")}>
          <I.square size={13} /> Whiteout
        </button>
        <button className={`tool-btn ${tool === "redact" ? "active" : ""}`} onClick={() => pick("redact")} title="Redaction permanently removes content: affected pages are flattened to images on save.">
          <I.redact size={13} /> Redact
        </button>
        <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && pickImage(e.target.files[0])} />
        <span className="sep" />
        {penKey ? (
          penKey !== "eraser" && (
            <>
              <input type="color" value={pen.color} onChange={(e) => applyPen({ color: e.target.value })} aria-label="Colour" title="Colour" style={{ width: 30, height: 28, border: "1px solid var(--line)", background: "transparent", borderRadius: 6, padding: 2 }} />
              {WIDTHS[penKey] && (
                <select className="select input-sm" style={{ width: 92 }} value={pen.width} onChange={(e) => applyPen({ width: Number(e.target.value) })} aria-label="Thickness" title="Thickness">
                  {[...new Set([...WIDTHS[penKey], pen.width])].sort((x, y) => x - y).map((w) => (
                    <option key={w} value={w}>
                      {w} pt
                    </option>
                  ))}
                </select>
              )}
            </>
          )
        ) : (
          <>
            <button className={`tool-btn ${shownStyle.bold ? "active" : ""}`} onClick={() => applyStyle({ bold: !shownStyle.bold })} aria-label="Bold" style={{ fontWeight: 700 }}>
              B
            </button>
            <button className={`tool-btn ${shownStyle.italic ? "active" : ""}`} onClick={() => applyStyle({ italic: !shownStyle.italic })} aria-label="Italic" style={{ fontStyle: "italic" }}>
              I
            </button>
            <button className={`tool-btn ${shownStyle.underline ? "active" : ""}`} onClick={() => applyStyle({ underline: !shownStyle.underline })} aria-label="Underline" style={{ textDecoration: "underline" }}>
              U
            </button>
            <select
              className="select input-sm"
              style={{ width: 150 }}
              value={shownStyle.family ?? (shownStyle.serif ? "Times New Roman" : "Arial")}
              onChange={(e) => applyStyle({ family: e.target.value, serif: isSerif(e.target.value) })}
              aria-label="Font"
            >
              {[...new Set([sel && "origFamily" in sel ? sel.origFamily : undefined, shownStyle.family, ...FONT_CHOICES].filter(Boolean) as string[])].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <input className="input input-sm" type="number" min={5} max={96} style={{ width: 62 }} value={Math.round(shownStyle.size)} onChange={(e) => applyStyle({ size: Math.max(5, Math.min(96, Number(e.target.value) || 11)) })} aria-label="Font size" />
            <input type="color" value={shownStyle.color} onChange={(e) => applyStyle({ color: e.target.value })} aria-label="Text color" style={{ width: 30, height: 28, border: "1px solid var(--line)", background: "transparent", borderRadius: 6, padding: 2 }} />
          </>
        )}
        <span className="sep" />
        <button className="tool-btn" onClick={doUndo} disabled={!undo.length} aria-label="Undo">
          <I.undo size={13} />
        </button>
        <button className="tool-btn" onClick={doRedo} disabled={!redo.length} aria-label="Redo">
          <I.redo size={13} />
        </button>
        <span className="sep" />
        <button className="tool-btn" onClick={() => setScale((s) => Math.max(0.5, s - 0.15))} aria-label="Zoom out">
          <I.zoomOut size={13} />
        </button>
        <button className="tool-btn" onClick={() => setScale((s) => Math.min(3, s + 0.15))} aria-label="Zoom in">
          <I.zoomIn size={13} />
        </button>
        {tool === "redact" && <span className="small" style={{ color: "var(--warn)" }}>Drag over content to redact. Redacted pages are flattened on save so the hidden text is gone for good.</span>}
        {hint[tool] && <span className="small faint">{hint[tool]}</span>}
      </div>
      <div className="page-scroll" ref={scrollRef} onClick={() => setSelected(null)}>
        <PdfViewer
          src={src}
          scale={scale}
          textLayer={false}
          scrollRef={scrollRef}
          renderOverlay={(pageInfo) => (
            <EditLayer
              info={pageInfo}
              src={src}
              tool={tool}
              markKind={markKind}
              inkKind={inkKind}
              shapeKind={shapeKind}
              pen={penKey ? pens[penKey] : pens.shape}
              style={style}
              ops={ops.filter((o) => o.page === pageInfo.page)}
              selected={selected}
              setSelected={setSelected}
              commit={commit}
              commitSilently={setOps}
              pendingImage={pendingImage}
              onPlacedImage={() => {
                setPendingImage(null);
                setTool("select");
              }}
            />
          )}
        />
      </div>
    </>
  );
}

/** A toolbar button that opens a short list of related tools (Highlight ▾, Draw ▾, Shape ▾). */
function ToolMenu<K extends string>({ label, items, active, current, onPick }: { label: string; items: [K, string, React.ReactNode][]; active: boolean; current: K; onPick: (k: K) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const cur = items.find((i) => i[0] === current) ?? items[0];
  return (
    <div className="tool-menu" ref={ref}>
      <button className={`tool-btn ${active ? "active" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {cur[2]} {active ? cur[1] : label} <I.chevron size={11} />
      </button>
      {open && (
        <div className="tool-menu-list" role="menu">
          {items.map(([k, l, icon]) => (
            <button
              key={k}
              role="menuitemradio"
              aria-checked={active && k === current}
              className={active && k === current ? "on" : ""}
              onClick={() => {
                onPick(k);
                setOpen(false);
              }}
            >
              {icon} {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- per-page overlay ----------

function EditLayer({
  info,
  src,
  tool,
  markKind,
  inkKind,
  shapeKind,
  pen,
  style,
  ops,
  selected,
  setSelected,
  commit,
  commitSilently,
  pendingImage,
  onPlacedImage,
}: {
  info: PageInfo;
  src: string;
  tool: Tool;
  markKind: MarkKind;
  inkKind: InkKind;
  shapeKind: ShapeKind;
  pen: Pen;
  style: Style;
  ops: Op[];
  selected: string | null;
  setSelected: (id: string | null) => void;
  commit: (fn: (o: Op[]) => Op[]) => void;
  /** Mutates ops without an undo snapshot (drags snapshot once at the start). */
  commitSilently: (fn: (o: Op[]) => Op[]) => void;
  pendingImage: { dataUrl: string; w: number; h: number } | null;
  onPlacedImage: () => void;
}) {
  const vp = info.viewport;
  const [runs, setRuns] = useState<TextRun[]>([]);
  const [editing, setEditing] = useState<{ opId?: string; run?: TextRun; x: number; y: number; text: string; style: Style } | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number; shift?: boolean } | null>(null);
  const [ink, setInk] = useState<Pt[] | null>(null);
  const [erasing, setErasing] = useState(false);
  const erased = useRef(false);
  const openedAt = useRef(0);
  const layer = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadPdf(src)
      .then((d) => d.getPage(info.page))
      .then(textRuns)
      .then((r) => !cancelled && setRuns(r))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [src, info.page]);

  // The page's main typeface: new text boxes default to it.
  const pageFamily = (() => {
    const counts = new Map<string, number>();
    for (const r of runs) counts.set(r.family, (counts.get(r.family) ?? 0) + r.str.length);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  })();

  // Preload the faces used by text being edited so previews already look right.
  useEffect(() => {
    for (const o of ops) if ((o.type === "text" || o.type === "replace") && o.family) void loadFontBytes(o.family, o.bold, o.italic);
    if (editing?.style.family) void loadFontBytes(editing.style.family, editing.style.bold, editing.style.italic);
  }, [ops, editing]);

  const toCss = (x: number, y: number) => vp.convertToViewportPoint(x, y) as [number, number];
  const toPdf = (px: number, py: number) => vp.convertToPdfPoint(px, py) as [number, number];
  const rectCss = (x: number, y: number, w: number, h: number) => {
    const [ax, ay] = toCss(x, y);
    const [bx, by] = toCss(x + w, y + h);
    return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
  };
  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const r = layer.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as [number, number];
  };

  const selDrawn = ops.find((o): o is MarkOp | InkOp | ShapeOp => o.id === selected && isDrawn(o));
  const replaced = new Set(ops.filter((o): o is TextOp => o.type === "replace").map((o) => `${o.x.toFixed(1)}:${o.y.toFixed(1)}`));

  const pdfPt = (px: number, py: number): Pt => toPdf(px, py).map((v) => Math.round(v * 100) / 100) as Pt;
  /** Shape corners in CSS pixels, with Shift keeping squares square and lines at 45° steps. */
  const shapeEnds = (d: NonNullable<typeof drag>): [Pt, Pt] => {
    let [x1, y1] = [d.x1, d.y1];
    if (Math.hypot(x1 - d.x0, y1 - d.y0) < 4) {
      // A click stamps a default-sized shape.
      const z = info.scale;
      const [w, h] = shapeKind === "check" || shapeKind === "cross" ? [16, 16] : shapeKind === "line" || shapeKind === "arrow" ? [90, 0] : shapeKind === "ellipse" ? [60, 60] : [100, 56];
      if (shapeKind === "check" || shapeKind === "cross") return [[d.x0 - (w * z) / 2, d.y0 - (h * z) / 2], [d.x0 + (w * z) / 2, d.y0 + (h * z) / 2]];
      return [[d.x0, d.y0], [d.x0 + w * z, d.y0 + h * z]];
    }
    if (d.shift) {
      const [dx, dy] = [x1 - d.x0, y1 - d.y0];
      if (shapeKind === "line" || shapeKind === "arrow") {
        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(dx, dy);
        [x1, y1] = [d.x0 + Math.cos(a) * len, d.y0 + Math.sin(a) * len];
      } else {
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        [x1, y1] = [d.x0 + Math.sign(dx || 1) * m, d.y0 + Math.sign(dy || 1) * m];
      }
    }
    return [[d.x0, d.y0], [x1, y1]];
  };
  const shapeOp = (d: NonNullable<typeof drag>): ShapeOp => {
    const [c0, c1] = shapeEnds(d);
    const [x1, y1] = pdfPt(...c0);
    const [x2, y2] = pdfPt(...c1);
    return { id: uid(), type: "shape", kind: shapeKind, page: info.page, x1, y1, x2, y2, color: pen.color, width: pen.width || 2 };
  };
  const markRects = (d: NonNullable<typeof drag>): [number, number, number, number][] => {
    const a = pdfPt(d.x0, d.y0);
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 3) {
      // A click marks the word group under the pointer.
      const r = runs.find((q) => q.str.trim() && a[0] >= q.x && a[0] <= q.x + q.w && a[1] >= q.y + Math.min(-0.15, q.descent) * q.size && a[1] <= q.y + Math.max(0.6, q.ascent) * q.size);
      return r ? [[r.x, r.y + Math.min(-0.15, r.descent) * r.size, r.w, (Math.max(0.6, r.ascent) - Math.min(-0.15, r.descent)) * r.size]] : [];
    }
    const b = pdfPt(d.x1, d.y1);
    const found = textUnder(runs, a, b);
    if (found.length) return found;
    // No text there (a scan, a picture): mark the dragged area itself.
    const [l, r, bo, t] = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])];
    return r - l > 3 && t - bo > 3 ? [[l, bo, r - l, t - bo]] : [];
  };
  const eraseAt = (px: number, py: number) => {
    const p = toPdf(px, py);
    const gone = new Set(ops.filter(isDrawn).filter((o) => hits(o, p, 6 / info.scale)).map((o) => o.id));
    if (!gone.size) return;
    const drop = (o: Op[]) => o.filter((x) => !gone.has(x.id));
    if (erased.current) commitSilently(drop);
    else commit(drop);
    erased.current = true;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.target !== layer.current) return;
    e.stopPropagation();
    const [px, py] = local(e);
    if (tool === "text") {
      // Without this the browser moves focus to the page right after the new box takes it, and an
      // empty box that loses focus is discarded: the "Add text does nothing" bug.
      e.preventDefault();
      if (editing) commitEdit();
      const [x, y] = toPdf(px, py + style.size * info.scale * 0.8);
      openedAt.current = Date.now();
      setEditing({ x, y, text: "", style });
    } else if (tool === "image" && pendingImage) {
      const wPt = Math.min(200, vp.width / info.scale / 2);
      const hPt = (wPt * pendingImage.h) / pendingImage.w;
      const [x, y] = toPdf(px, py);
      commit((o) => [...o, { id: uid(), type: "image", page: info.page, x, y: y - hPt, w: wPt, h: hPt, dataUrl: pendingImage.dataUrl }]);
      onPlacedImage();
    } else if (tool === "ink") {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      if (inkKind === "eraser") {
        erased.current = false;
        setErasing(true);
        eraseAt(px, py);
      } else setInk([[px, py]]);
    } else if (tool === "mark" || tool === "shape" || tool === "whiteout" || tool === "redact") {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDrag({ x0: px, y0: py, x1: px, y1: py, shift: e.shiftKey });
    } else setSelected(null);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag && !ink && !erasing) return;
    const [px, py] = local(e);
    if (erasing) eraseAt(px, py);
    else if (ink) {
      const last = ink[ink.length - 1];
      if (Math.hypot(px - last[0], py - last[1]) >= 1.5) setInk([...ink, [px, py]]);
    } else if (drag) setDrag({ ...drag, x1: px, y1: py, shift: e.shiftKey });
  };
  const onPointerUp = () => {
    if (erasing) {
      setErasing(false);
      return;
    }
    if (ink) {
      const pts = ink.length === 1 ? [ink[0], [ink[0][0] + 0.5, ink[0][1]] as Pt] : ink;
      const highlighter = inkKind === "highlighter";
      commit((o) => [...o, { id: uid(), type: "ink", page: info.page, points: pts.map(([x, y]) => pdfPt(x, y)), color: pen.color, width: pen.width || (highlighter ? 12 : 2), opacity: highlighter ? 0.35 : 1 }]);
      setInk(null);
      return;
    }
    if (!drag) return;
    if (tool === "mark") {
      const rects = markRects(drag);
      if (rects.length) commit((o) => [...o, { id: uid(), type: "mark", kind: markKind, page: info.page, rects, color: pen.color }]);
    } else if (tool === "shape") {
      const op = shapeOp(drag);
      commit((o) => [...o, op]);
    } else {
      const [ax, ay] = toPdf(Math.min(drag.x0, drag.x1), Math.max(drag.y0, drag.y1));
      const [bx, by] = toPdf(Math.max(drag.x0, drag.x1), Math.min(drag.y0, drag.y1));
      const w = Math.abs(bx - ax);
      const h = Math.abs(by - ay);
      if (w > 2 && h > 2) commit((o) => [...o, { id: uid(), type: tool as RectOp["type"], page: info.page, x: Math.min(ax, bx), y: Math.min(ay, by), w, h }]);
    }
    setDrag(null);
  };

  const startMoveDrawn = (e: React.PointerEvent, op: MarkOp | InkOp | ShapeOp) => {
    e.stopPropagation();
    e.preventDefault();
    setSelected(op.id);
    const [sx, sy] = [e.clientX, e.clientY];
    const origin = toPdf(0, 0);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const [dx, dy] = [ev.clientX - sx, ev.clientY - sy];
      if (!moved && Math.hypot(dx, dy) < 3) return;
      if (!moved) commit((o) => o); // one undo step for the whole drag
      moved = true;
      const p = toPdf(dx, dy);
      commitSilently((o) => o.map((x) => (x.id === op.id ? translate(op, p[0] - origin[0], p[1] - origin[1]) : x)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const pathD = (pts: Pt[], closed: boolean) => pts.map(([x, y], i) => `${i ? "L" : "M"}${toCss(x, y).map((v) => v.toFixed(1)).join(" ")}`).join("") + (closed ? "Z" : "");
  const drawn = (op: MarkOp | InkOp | ShapeOp, key: string, interactive: boolean) => {
    const g = geometry(op);
    const sw = Math.max(0.5, g.width * info.scale);
    return (
      <g key={key} opacity={g.opacity}>
        {g.paths.map((p, i) => (
          <path key={i} d={pathD(p.pts, p.closed)} fill={p.fill ? g.color : "none"} stroke={p.fill ? "none" : g.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {interactive &&
          g.paths.map((p, i) => (
            <path
              key={`h${i}`}
              className={p.fill ? "hit-area" : "hit"}
              d={pathD(p.pts, p.closed)}
              fill={p.fill ? "transparent" : "none"}
              stroke="transparent"
              strokeWidth={Math.max(12, sw + 8)}
              onPointerDown={(e) => startMoveDrawn(e, op)}
            />
          ))}
      </g>
    );
  };

  const commitEdit = () => {
    if (!editing) return;
    const text = editing.text;
    if (editing.opId) {
      commit((o) => (text.trim() || o.find((x) => x.id === editing.opId)?.type === "replace" ? o.map((x) => (x.id === editing.opId ? ({ ...x, text } as Op) : x)) : o.filter((x) => x.id !== editing.opId)));
    } else if (editing.run) {
      const r = editing.run;
      if (text !== r.str) {
        commit((o) => [
          ...o,
          {
            id: uid(),
            type: "replace",
            page: info.page,
            x: r.x,
            y: r.y,
            text,
            original: r.str,
            ow: r.w,
            ascent: r.ascent,
            descent: r.descent,
            size: r.size,
            bold: editing.style.bold,
            italic: editing.style.italic,
            underline: editing.style.underline,
            serif: r.serif,
            family: editing.style.family ?? r.family,
            origFamily: r.family,
            color: TEXT_COLOR,
          },
        ]);
      }
    } else if (text.trim()) {
      commit((o) => [...o, { id: uid(), type: "text", page: info.page, x: editing.x, y: editing.y, text, ...editing.style, family: editing.style.family ?? pageFamily }]);
    }
    setEditing(null);
  };

  const startMove = (e: React.PointerEvent, op: TextOp) => {
    e.stopPropagation();
    setSelected(op.id);
    if (tool !== "select" && tool !== "text") return;
    const [sx, sy] = [e.clientX, e.clientY];
    const [ox, oy] = toCss(op.x, op.y);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      if (!moved) commit((o) => o); // snapshot for undo
      moved = true;
      const [nx, ny] = toPdf(ox + dx, oy + dy);
      setOpsPos(op.id, nx, ny);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // Position updates during a drag shouldn't flood the undo stack.
  const setOpsPos = (id: string, x: number, y: number) => {
    commitSilently((o) => o.map((op) => (op.id === id ? ({ ...op, x, y } as Op) : op)));
  };

  const startResize = (e: React.PointerEvent, op: ImageOp) => {
    e.stopPropagation();
    const sx = e.clientX;
    const ratio = op.h / op.w;
    commit((o) => o);
    const move = (ev: PointerEvent) => {
      const w = Math.max(20, op.w + (ev.clientX - sx) / info.scale);
      const h = w * ratio;
      commitSilently((o) => o.map((x) => (x.id === op.id ? { ...x, w, h, y: op.y + op.h - h } : x)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const fontCss = (s: Style) => ({
    fontFamily: cssStack(s.family, s.serif),
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? "italic" : "normal",
    textDecoration: s.underline ? "underline" : "none",
    fontSize: s.size * info.scale,
    color: s.color,
    lineHeight: 1,
    whiteSpace: "pre" as const,
  });

  return (
    <div
      ref={layer}
      className={`edit-layer ${
        tool === "text" || (tool === "image" && pendingImage)
          ? "mode-text"
          : tool === "whiteout" || tool === "redact"
            ? "mode-rect"
            : tool === "mark"
              ? "mode-mark"
              : tool === "ink"
                ? inkKind === "eraser"
                  ? "mode-erase"
                  : "mode-draw"
                : tool === "shape"
                  ? "mode-draw"
                  : "mode-select"
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={(e) => e.stopPropagation()}
    >
      {tool === "select" &&
        runs
          .filter((r) => !replaced.has(`${r.x.toFixed(1)}:${r.y.toFixed(1)}`))
          .map((r, i) => {
            const c = coverRect({ ...r, ow: r.w });
            const box = rectCss(c.x, c.y, c.w, c.h);
            return (
              <div
                key={i}
                className="edit-run"
                data-text={r.str}
                style={box}
                title="Click to edit"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing({ run: r, x: r.x, y: r.y, text: r.str, style: { ...DEFAULT_STYLE, size: r.size, bold: r.bold, italic: r.italic, serif: r.serif, family: r.family, color: TEXT_COLOR } });
                }}
              />
            );
          })}

      {ops.map((op) => {
        if (isRect(op)) {
          const box = rectCss(op.x, op.y, op.w, op.h);
          const bg = op.type === "highlight" ? "rgba(255, 214, 0, 0.4)" : op.type === "whiteout" ? "#fff" : "#000";
          return (
            <div key={op.id} className={`edit-op ${selected === op.id ? "selected" : ""}`} style={{ ...box, background: bg }} onPointerDown={(e) => { e.stopPropagation(); setSelected(op.id); }}>
              {op.type === "redact" && <span className="mono" style={{ color: "#fff", fontSize: 9, padding: 2 }}>REDACTED</span>}
              <button className="op-del" onClick={() => commit((o) => o.filter((x) => x.id !== op.id))} aria-label="Remove">×</button>
            </div>
          );
        }
        if (op.type === "image") {
          const box = rectCss(op.x, op.y, op.w, op.h);
          return (
            <div key={op.id} className={`edit-op ${selected === op.id ? "selected" : ""}`} style={{ ...box, cursor: "move" }} onPointerDown={(e) => startMoveImage(e, op)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={op.dataUrl} alt="" style={{ width: "100%", height: "100%", pointerEvents: "none" }} />
              <button className="op-del" onClick={() => commit((o) => o.filter((x) => x.id !== op.id))} aria-label="Remove">×</button>
              <div onPointerDown={(e) => startResize(e, op)} style={{ position: "absolute", right: -5, bottom: -5, width: 12, height: 12, background: "var(--amber)", borderRadius: 3, cursor: "nwse-resize" }} />
            </div>
          );
        }
        if (isDrawn(op) || editing?.opId === op.id) return null;
        const [px, py] = toCss(op.x, op.y);
        const fs = op.size * info.scale;
        return (
          <div key={op.id} style={{ position: "absolute", left: 0, top: 0 }}>
            {op.type === "replace" && op.ow && (() => {
              const c = coverRect(op);
              return <div style={{ position: "absolute", ...rectCss(c.x, c.y, c.w, c.h), background: "#fff" }} />;
            })()}
            <div
              className={`edit-op ${selected === op.id ? "selected" : ""}`}
              style={{ left: px, top: py - fs * 0.82, ...fontCss(op), cursor: "move", padding: "0 1px" }}
              onPointerDown={(e) => startMove(e, op)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing({ opId: op.id, x: op.x, y: op.y, text: op.text, style: op });
              }}
            >
              {op.text || " "}
              <button className="op-del" onPointerDown={(e) => e.stopPropagation()} onClick={() => commit((o) => o.filter((x) => x.id !== op.id))} aria-label="Remove">×</button>
            </div>
          </div>
        );
      })}

      <svg className="edit-draw" aria-hidden>
        {ops.filter(isDrawn).map((op) => drawn(op, op.id, tool === "select"))}
        {selDrawn &&
          (() => {
            const [l, b, r, t] = bounds(selDrawn);
            const box = rectCss(l, b, r - l, t - b);
            return <rect className="sel-box" x={box.left - 4} y={box.top - 4} width={box.width + 8} height={box.height + 8} rx={3} />;
          })()}
        {drag && tool === "mark" && drawn({ id: "", type: "mark", kind: markKind, page: info.page, rects: markRects(drag), color: pen.color }, "preview", false)}
        {drag && tool === "shape" && drawn(shapeOp(drag), "preview", false)}
        {ink && (
          <path d={ink.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("")} fill="none" stroke={pen.color} strokeOpacity={inkKind === "highlighter" ? 0.35 : 1} strokeWidth={(pen.width || 2) * info.scale} strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
      {selDrawn &&
        (() => {
          const [l, b, r, t] = bounds(selDrawn);
          const box = rectCss(l, b, r - l, t - b);
          return (
            <button
              className="edit-draw-del"
              style={{ left: box.left + box.width - 6, top: box.top - 16 }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                commit((o) => o.filter((x) => x.id !== selDrawn.id));
                setSelected(null);
              }}
              aria-label="Remove"
            >
              ×
            </button>
          );
        })()}

      {editing && (
        <>
          {editing.run && (() => {
            const c = coverRect({ ...editing.run, ow: editing.run.w });
            return <div style={{ position: "absolute", ...rectCss(c.x, c.y, c.w, c.h), background: "#fff" }} />;
          })()}
          <input
            className="edit-input"
            ref={input}
            autoFocus
            placeholder="Type here"
            value={editing.text}
            size={Math.max(4, editing.text.length + 1)}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setEditing(null);
            }}
            onBlur={() => {
              // A brand-new empty box that loses focus at once (a stray click) stays open.
              if (!editing.text && Date.now() - openedAt.current < 400) requestAnimationFrame(() => input.current?.focus());
              else commitEdit();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              left: toCss(editing.x, editing.y)[0] - 2,
              top: toCss(editing.x, editing.y)[1] - editing.style.size * info.scale * 0.95,
              ...fontCss(editing.style),
              height: editing.style.size * info.scale * 1.3,
            }}
          />
        </>
      )}
      {drag && (tool === "whiteout" || tool === "redact") && (
        <div
          style={{
            position: "absolute",
            left: Math.min(drag.x0, drag.x1),
            top: Math.min(drag.y0, drag.y1),
            width: Math.abs(drag.x1 - drag.x0),
            height: Math.abs(drag.y1 - drag.y0),
            background: tool === "redact" ? "rgba(0,0,0,.8)" : "rgba(255,255,255,.9)",
            border: "1px dashed var(--amber)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );

  function startMoveImage(e: React.PointerEvent, op: ImageOp) {
    e.stopPropagation();
    setSelected(op.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const [ox, oy] = toCss(op.x, op.y + op.h);
    commit((o) => o);
    const move = (ev: PointerEvent) => {
      const [nx, ny] = toPdf(ox + ev.clientX - sx, oy + ev.clientY - sy);
      commitSilently((o) => o.map((x) => (x.id === op.id ? { ...x, x: nx, y: ny - op.h } : x)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
}


// ---------- building the PDF ----------

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * fontkit wrapper that tolerates malformed glyphs. Many Google Fonts builds (Arimo, Cousine, Carlito…)
 * end with an empty glyph whose outline offset sits at the very end of the glyf table; fontkit reads
 * past the buffer measuring it, and the whole save fails with "Trying to access beyond buffer length".
 * Such glyphs get an empty box instead, which is what an empty glyph has anyway.
 */
type GlyphProto = { _getCBox: (...a: unknown[]) => unknown; _decode?: (...a: unknown[]) => unknown; __pdftekSafe?: boolean };
const safeFontkit: typeof fontkit = {
  ...fontkit,
  create(...args: Parameters<typeof fontkit.create>) {
    const font = fontkit.create(...args);
    try {
      const glyph = font.getGlyph(0) as unknown as object;
      const BBox = (font.bbox as object).constructor as new (a: number, b: number, c: number, d: number) => unknown;
      for (let proto = Object.getPrototypeOf(glyph) as GlyphProto | null; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
        if (proto.__pdftekSafe || !Object.prototype.hasOwnProperty.call(proto, "_getCBox")) continue;
        const cbox = proto._getCBox;
        proto._getCBox = function (this: unknown, ...a: unknown[]) {
          try {
            return cbox.apply(this, a);
          } catch {
            return new BBox(0, 0, 0, 0);
          }
        };
        const decode = Object.prototype.hasOwnProperty.call(proto, "_decode") ? proto._decode : undefined;
        if (decode) {
          proto._decode = function (this: unknown, ...a: unknown[]) {
            try {
              return decode.apply(this, a);
            } catch {
              return null;
            }
          };
        }
        proto.__pdftekSafe = true;
      }
    } catch {}
    return font;
  },
};

/** Builds the edited PDF. `standardFontsOnly` is the fallback when an embedded font can't be written. */
async function buildPdf(src: string, ops: Op[], standardFontsOnly = false): Promise<Uint8Array> {
  const original = new Uint8Array(await (await fetch(src)).arrayBuffer());
  const pdf = await PDFDocument.load(original);
  pdf.registerFontkit(safeFontkit);
  const fontCache = new Map<string, PDFFont>();
  const font = async (s: Style) => {
    // Prefer the document's own typeface (or a metric-compatible open equivalent).
    if (s.family && !standardFontsOnly) {
      const k = `${s.family}|${s.bold}|${s.italic}`;
      if (!fontCache.has(k)) {
        const bytes = await loadFontBytes(s.family, s.bold, s.italic);
        if (bytes) {
          try {
            // Full embed without ligatures: pdf-lib's subsetter drops glyphs from many Google Fonts TTFs, and
            // ligature glyphs ("fi") get the wrong advance, leaving a gap after them.
            fontCache.set(k, await pdf.embedFont(bytes, { subset: false, features: { liga: false, clig: false, dlig: false } }));
          } catch {}
        }
      }
      const f = fontCache.get(k);
      if (f) return f;
    }
    const key = `${s.serif ? "T" : "H"}${s.bold ? "B" : ""}${s.italic ? "I" : ""}`;
    const name: Record<string, StandardFonts> = {
      H: StandardFonts.Helvetica,
      HB: StandardFonts.HelveticaBold,
      HI: StandardFonts.HelveticaOblique,
      HBI: StandardFonts.HelveticaBoldOblique,
      T: StandardFonts.TimesRoman,
      TB: StandardFonts.TimesRomanBold,
      TI: StandardFonts.TimesRomanItalic,
      TBI: StandardFonts.TimesRomanBoldItalic,
    };
    if (!fontCache.has(key)) fontCache.set(key, await pdf.embedFont(name[key]));
    return fontCache.get(key)!;
  };
  // A font may lack some characters (standard fonts only cover Latin-1); replace them rather than failing.
  const safe = (f: PDFFont, text: string) =>
    [...text]
      .map((ch) => {
        try {
          f.encodeText(ch);
          return ch;
        } catch {
          return "?";
        }
      })
      .join("");

  const pages = pdf.getPages();
  for (const op of ops) {
    const page = pages[op.page - 1];
    if (!page) continue;
    if (isRect(op)) {
      const color = op.type === "highlight" ? rgb(1, 0.84, 0) : op.type === "whiteout" ? rgb(1, 1, 1) : rgb(0, 0, 0);
      page.drawRectangle({ x: op.x, y: op.y, width: op.w, height: op.h, color, opacity: op.type === "highlight" ? 0.35 : 1 });
    } else if (isDrawn(op)) {
      const g = geometry(op);
      const color = hexToRgb(g.color);
      const blendMode = g.multiply ? BlendMode.Multiply : undefined;
      // Round joins keep pen strokes smooth; pdf-lib has no option for it, so set it around the path.
      page.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
      for (const p of g.paths) {
        // drawSvgPath flips y, so feed it page coordinates with y negated.
        const d = p.pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${(-y).toFixed(2)}`).join("") + (p.closed ? "Z" : "");
        if (p.fill) page.drawSvgPath(d, { x: 0, y: 0, color, opacity: g.opacity, blendMode });
        else page.drawSvgPath(d, { x: 0, y: 0, borderColor: color, borderWidth: g.width, borderOpacity: g.opacity, borderLineCap: LineCapStyle.Round, blendMode });
      }
      page.pushOperators(popGraphicsState());
    } else if (op.type === "image") {
      const img = await pdf.embedJpg(Uint8Array.from(atob(op.dataUrl.split(",")[1]), (c) => c.charCodeAt(0)));
      page.drawImage(img, { x: op.x, y: op.y, width: op.w, height: op.h });
    } else {
      const f = await font(op);
      if (op.type === "replace" && op.ow) {
        const c = coverRect(op);
        page.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, color: rgb(1, 1, 1) });
      }
      const text = safe(f, op.text);
      const color = hexToRgb(op.color);
      page.drawText(text, { x: op.x, y: op.y, size: op.size, font: f, color });
      if (op.underline) {
        const w = f.widthOfTextAtSize(text, op.size);
        page.drawLine({ start: { x: op.x, y: op.y - op.size * 0.12 }, end: { x: op.x + w, y: op.y - op.size * 0.12 }, thickness: Math.max(0.5, op.size / 16), color });
      }
    }
  }
  let bytes = await pdf.save();

  // True redaction: flatten every page that has a redaction so the underlying text/vectors are gone.
  const redactPages = [...new Set(ops.filter((o) => o.type === "redact").map((o) => o.page))];
  if (redactPages.length) {
    const rendered = await loadPdf(bytes);
    const out = await PDFDocument.load(bytes);
    for (const p of redactPages) {
      const pg = await rendered.getPage(p);
      const canvas = await pageToCanvas(pg, 2.5);
      const jpg = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.92));
      const img = await out.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
      const old = out.getPage(p - 1);
      const { width, height } = old.getSize();
      const rot = old.getRotation().angle % 180 !== 0;
      const [w, h] = rot ? [height, width] : [width, height];
      out.removePage(p - 1);
      const fresh = out.insertPage(p - 1, [w, h]);
      fresh.drawImage(img, { x: 0, y: 0, width: w, height: h });
    }
    await rendered.destroy();
    bytes = await out.save();
  }
  return bytes;
}

export type { PageViewport };
