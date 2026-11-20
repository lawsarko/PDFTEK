"use client";
import { useEffect, useRef } from "react";
import { I } from "./icons";

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Escape closes only the topmost window (e.g. the scanner opened from a tool window).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const open = document.querySelectorAll(".modal-backdrop");
      if (open[open.length - 1] === ref.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div ref={ref} className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <I.x />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Menu({
  open,
  onClose,
  children,
  align = "right",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  useEffect(() => {
    if (!open) return;
    const h = () => onClose();
    const t = setTimeout(() => window.addEventListener("click", h), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("click", h);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={`menu ${align === "left" ? "left" : ""}`} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}
