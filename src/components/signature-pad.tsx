"use client";
import { useEffect, useRef, useState } from "react";

const SCRIPT_FONTS = ["'Brush Script MT', cursive", "'Segoe Script', cursive", "'Snell Roundhand', cursive", "cursive"];

/** Draw or type a signature; returns a transparent PNG data URL (or null when empty). */
export function SignaturePad({ name, onChange, height = 150 }: { name: string; onChange: (png: string | null) => void; height?: number }) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState(name);
  const [font, setFont] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = height * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b1f4a";
    ctx.lineWidth = 2.4;
    dirty.current = false;
    if (mode === "type") renderTyped();
    else onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, height]);

  useEffect(() => {
    if (mode === "type") renderTyped();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, font]);

  function renderTyped() {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!typed.trim()) return onChange(null);
    const w = c.clientWidth;
    let size = 54;
    ctx.fillStyle = "#0b1f4a";
    ctx.textBaseline = "middle";
    do {
      ctx.font = `${size}px ${SCRIPT_FONTS[font]}`;
      size -= 2;
    } while (ctx.measureText(typed).width > w - 24 && size > 16);
    ctx.fillText(typed, 12, height / 2);
    onChange(c.toDataURL("image/png"));
  }

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <div className="col gap-8">
      <div className="row gap-4">
        <button type="button" className={`chip ${mode === "draw" ? "active" : ""}`} onClick={() => setMode("draw")}>
          Draw
        </button>
        <button type="button" className={`chip ${mode === "type" ? "active" : ""}`} onClick={() => setMode("type")}>
          Type
        </button>
        <span className="grow" />
        {mode === "draw" && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              const c = canvas.current!;
              c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
              dirty.current = false;
              onChange(null);
            }}
          >
            Clear
          </button>
        )}
      </div>
      {mode === "type" && (
        <div className="row gap-8">
          <input className="input grow" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your name" />
          <button type="button" className="btn btn-sm" onClick={() => setFont((f) => (f + 1) % SCRIPT_FONTS.length)}>
            Style
          </button>
        </div>
      )}
      <canvas
        ref={canvas}
        style={{ width: "100%", height, background: "#fff", borderRadius: 8, touchAction: "none", cursor: mode === "draw" ? "crosshair" : "default", border: "1px solid var(--line)" }}
        onPointerDown={(e) => {
          if (mode !== "draw") return;
          drawing.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const ctx = canvas.current!.getContext("2d")!;
          const [x, y] = pos(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvas.current!.getContext("2d")!;
          const [x, y] = pos(e);
          ctx.lineTo(x, y);
          ctx.stroke();
          dirty.current = true;
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          if (dirty.current) onChange(trimmed(canvas.current!));
        }}
      />
      <div className="tiny faint">{mode === "draw" ? "Sign with your mouse, trackpad or finger." : "Your typed name is rendered as a signature image."}</div>
    </div>
  );
}

/** Crops transparent margins so the stamped signature fills its field. */
function trimmed(c: HTMLCanvasElement): string {
  const ctx = c.getContext("2d")!;
  const { width, height } = c;
  const data = ctx.getImageData(0, 0, width, height).data;
  let [minX, minY, maxX, maxY] = [width, height, 0, 0];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
  if (maxX <= minX) return c.toDataURL("image/png");
  const pad = 8;
  const out = document.createElement("canvas");
  out.width = maxX - minX + pad * 2;
  out.height = maxY - minY + pad * 2;
  out.getContext("2d")!.drawImage(c, minX - pad, minY - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
