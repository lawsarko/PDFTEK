"use client";
import { STAGES } from "@/lib/client-shared";

/** Small shared pieces of the firm screens. */

const PALETTE = ["#b84a0b", "#1a73e8", "#188038", "#a142f4", "#d93025", "#007b83", "#e37400", "#5f6368"];

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = PALETTE[h % PALETTE.length];
  return (
    <span className="fa-avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: bg }} aria-hidden>
      {initials || "?"}
    </span>
  );
}

export function StageChip({ stage }: { stage: string }) {
  const s = STAGES.find((x) => x.key === stage) ?? STAGES[0];
  return <span className={`fa-chip tone-${s.tone}`}>{s.label}</span>;
}

export function Kpi({ label, value, hint, tone, onClick, icon }: { label: string; value: number | string; hint?: string; tone?: "warn" | "bad" | "good" | "info"; onClick?: () => void; icon?: React.ReactNode }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`fa-kpi ${tone ? `tone-${tone}` : ""}`} onClick={onClick} type={onClick ? "button" : undefined}>
      <span className="fa-kpi-top">
        {icon && <span className="fa-kpi-ico">{icon}</span>}
        <span className="fa-kpi-label">{label}</span>
      </span>
      <b className="fa-kpi-value">{value}</b>
      {hint && <span className="fa-kpi-hint">{hint}</span>}
    </Tag>
  );
}

export function Empty({ icon, title, body, children }: { icon?: React.ReactNode; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="fa-empty">
      {icon && <span className="fa-empty-ico">{icon}</span>}
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {children && <div className="row gap-8 wrap center">{children}</div>}
    </div>
  );
}

export const fmtDate = (t: number | string | null | undefined) =>
  t ? new Date(typeof t === "string" ? `${t}T12:00:00` : t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
export const fmtShort = (t: number | string) => new Date(typeof t === "string" ? `${t}T12:00:00` : t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function daysUntil(date: string) {
  return Math.round((Date.parse(`${date}T12:00:00`) - Date.now()) / 86_400_000);
}
