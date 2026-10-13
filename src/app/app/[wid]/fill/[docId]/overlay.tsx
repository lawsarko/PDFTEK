"use client";
import { useRef } from "react";
import type { PageInfo } from "@/components/pdf-viewer";
import { I } from "@/components/icons";
import type { FieldOption, FieldType, FormField, FormValues, Rect } from "@/lib/forms";

/**
 * Draws the form's fields on top of a rendered PDF page. In "fill" mode they are live inputs; in
 * "layout" mode they can be moved, resized and deleted, and clicking the page adds a new field.
 */

type Props = {
  info: PageInfo;
  fields: FormField[];
  values: FormValues;
  signatures: Record<string, string>;
  errors: Record<string, string | null>;
  selected: string | null;
  mode: "fill" | "layout";
  newType: FieldType;
  onChange: (id: string, value: string) => void;
  onSelect: (id: string | null) => void;
  onSign: (id: string) => void;
  onRect: (id: string, rect: Rect, optionIndex?: number) => void;
  onAdd: (page: number, rect: Rect) => void;
  onDelete: (id: string) => void;
};

type VpBox = { left: number; top: number; width: number; height: number };

function toVp(info: PageInfo, r: Rect): VpBox {
  const [x1, y1, x2, y2] = info.viewport.convertToViewportRectangle([r[0], r[1], r[0] + r[2], r[1] + r[3]]);
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

function toPdf(info: PageInfo, b: VpBox): Rect {
  const [ax, ay] = info.viewport.convertToPdfPoint(b.left, b.top);
  const [bx, by] = info.viewport.convertToPdfPoint(b.left + b.width, b.top + b.height);
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  return [x, y, Math.abs(bx - ax), Math.abs(by - ay)].map((v) => Math.round(v * 100) / 100) as Rect;
}

const DEFAULT_SIZE: Partial<Record<FieldType, [number, number]>> = { checkbox: [12, 12], signature: [170, 34], initials: [60, 26], multiline: [260, 54], date: [100, 16] };

export function FieldLayer(p: Props) {
  const layer = useRef<HTMLDivElement>(null);

  const addAt = (e: React.MouseEvent) => {
    if (p.mode !== "layout" || e.target !== e.currentTarget) {
      if (p.mode === "fill" && e.target === e.currentTarget) p.onSelect(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const [w, h] = DEFAULT_SIZE[p.newType] ?? [170, 16];
    const scale = p.info.viewport.scale;
    const box = { left: e.clientX - r.left, top: e.clientY - r.top - (h * scale) / 2, width: w * scale, height: h * scale };
    p.onAdd(p.info.page, toPdf(p.info, box));
  };

  const drag = (e: React.PointerEvent, f: FormField, rect: Rect, resize: boolean, optionIndex?: number) => {
    if (p.mode !== "layout") return;
    e.stopPropagation();
    e.preventDefault();
    p.onSelect(f.id);
    const start = toVp(p.info, rect);
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      const b = resize
        ? { ...start, width: Math.max(8, start.width + dx), height: Math.max(8, start.height + dy) }
        : { ...start, left: start.left + dx, top: start.top + dy };
      p.onRect(f.id, toPdf(p.info, b), optionIndex);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={layer} className={`ff-layer ${p.mode === "layout" ? "ff-layout" : ""}`} onClick={addAt}>
      {p.fields.map((f) => {
        const value = p.values[f.id];
        const cls = [
          "ff-field",
          `ff-${f.type}`,
          p.selected === f.id ? "ff-sel" : "",
          value?.value ? `ff-src-${value.source}` : "",
          value && value.source === "ai" && (value.confidence ?? 1) < 0.75 ? "ff-low" : "",
          p.errors[f.id] ? "ff-err" : "",
          f.required && !value?.value && f.type !== "checkbox" ? "ff-req" : "",
        ].join(" ");

        // Radio groups drawn as separate choices on the page.
        if (f.type === "radio" && f.options?.some((o) => o.rect)) {
          return f.options.map((o, i) =>
            o.rect && (o.page ?? f.page) === p.info.page ? (
              <RadioDot key={`${f.id}-${i}`} f={f} o={o} i={i} box={toVp(p.info, o.rect)} cls={cls} {...p} drag={drag} />
            ) : null,
          );
        }
        if (f.page !== p.info.page) return null;
        const box = toVp(p.info, f.rect);
        const style: React.CSSProperties = { left: box.left, top: box.top, width: box.width, height: box.height };
        const fontSize = Math.max(9, Math.min(16, box.height * 0.62));

        if (p.mode === "layout") {
          return (
            <div key={f.id} className={`${cls} ff-box`} style={style} onPointerDown={(e) => drag(e, f, f.rect, false)} title={f.label}>
              <span className="ff-box-label">{f.label}</span>
              {p.selected === f.id && (
                <>
                  <button className="ff-del" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); p.onDelete(f.id); }} aria-label="Delete field">
                    <I.x size={10} />
                  </button>
                  <span className="ff-resize" onPointerDown={(e) => drag(e, f, f.rect, true)} />
                </>
              )}
            </div>
          );
        }

        const common = {
          "data-fid": f.id,
          "aria-label": f.label,
          title: f.help ? `${f.label}: ${f.help}` : f.label,
          onFocus: () => p.onSelect(f.id),
        };

        switch (f.type) {
          case "checkbox": {
            const on = /^(true|yes|on|1|x|✓|checked)$/i.test(value?.value ?? "");
            return (
              <button key={f.id} {...common} className={`${cls} ff-tick ${on ? "on" : ""}`} style={style} onClick={() => { p.onSelect(f.id); p.onChange(f.id, on ? "false" : "true"); }}>
                {on && <I.check size={Math.max(9, Math.min(box.width, box.height) * 0.9)} />}
              </button>
            );
          }
          case "signature":
          case "initials": {
            const img = p.signatures[f.id];
            return (
              <button key={f.id} {...common} className={`${cls} ff-sign ${img ? "signed" : ""}`} style={style} onClick={() => { p.onSelect(f.id); p.onSign(f.id); }}>
                {img ? <img src={img} alt="Signature" /> : <span><I.sign size={12} /> {f.type === "initials" ? "Initial" : "Sign here"}</span>}
              </button>
            );
          }
          case "choice":
          case "radio":
            return (
              <select key={f.id} {...common} className={cls} style={{ ...style, fontSize }} value={value?.value ?? ""} onChange={(e) => p.onChange(f.id, e.target.value)}>
                <option value="" />
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
          case "multiline":
            return (
              <textarea key={f.id} {...common} className={cls} style={{ ...style, fontSize: Math.min(fontSize, 12) }} value={value?.value ?? ""} onChange={(e) => p.onChange(f.id, e.target.value)} />
            );
          default: {
            const comb = f.comb && f.maxLength ? box.width / f.maxLength : 0;
            return (
              <input
                key={f.id}
                {...common}
                className={cls}
                style={{ ...style, fontSize, ...(comb ? { letterSpacing: `${Math.max(0, comb - fontSize * 0.6)}px`, paddingLeft: comb / 2 - fontSize * 0.3 } : {}) }}
                value={value?.value ?? ""}
                maxLength={f.maxLength}
                placeholder={f.type === "date" ? (f.format ?? "MM/DD/YYYY") : undefined}
                inputMode={f.type === "number" ? "decimal" : f.type === "phone" ? "tel" : f.type === "email" ? "email" : undefined}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => p.onChange(f.id, e.target.value)}
              />
            );
          }
        }
      })}
    </div>
  );
}

function RadioDot(
  props: Props & { f: FormField; o: FieldOption; i: number; box: VpBox; cls: string; drag: (e: React.PointerEvent, f: FormField, rect: Rect, resize: boolean, optionIndex?: number) => void },
) {
  const { f, o, i, box, cls } = props;
  const on = props.values[f.id]?.value === o.value;
  const style = { left: box.left, top: box.top, width: Math.max(10, box.width), height: Math.max(10, box.height) };
  if (props.mode === "layout") {
    return <div className={`${cls} ff-box ff-radio-box`} style={style} title={`${f.label}: ${o.label}`} onPointerDown={(e) => props.drag(e, f, o.rect!, false, i)} />;
  }
  return (
    <button
      data-fid={f.id}
      className={`${cls} ff-radio ${on ? "on" : ""}`}
      style={style}
      title={`${f.label}: ${o.label}`}
      aria-label={`${f.label}: ${o.label}`}
      aria-pressed={on}
      onFocus={() => props.onSelect(f.id)}
      onClick={() => {
        props.onSelect(f.id);
        props.onChange(f.id, on ? "" : o.value);
      }}
    >
      {on && <span className="ff-radio-dot" />}
    </button>
  );
}
