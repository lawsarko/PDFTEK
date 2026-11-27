"use client";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { I } from "../icons";

const KEY = "pdftek-tour";

type Stop = { sel: string; title: string; text: string };
const STOPS: Stop[] = [
  { sel: ".wb-new", title: "Add documents", text: "Upload files, scan with your camera, or open them from Google Drive, Dropbox or OneDrive. You can also drop files anywhere on Home." },
  { sel: ".wb-quick", title: "Quick starts", text: "Start the things people do most. Pick one before uploading and pdftek runs it as soon as your file is in." },
  { sel: ".wb-top-search", title: "Search everything", text: "Find documents, words inside any page or a tool, or ask the AI. Press / to jump here." },
  { sel: ".wb-nav a.wb-ni", title: "Clients, signatures and requests", text: "Collect documents, send things for signature and give clients their own portal from the menu on the left." },
  { sel: ".wb-help", title: "Help is always here", text: "Guides and short videos for every feature. Open a document next: every tool is listed on the left, and Ask AI is at the top." },
];

/**
 * A five-stop tour of Home, shown once to new accounts on a computer (and any time from the
 * Help menu). Each stop points at the real control it describes.
 */
export function Tour() {
  const [step, setStep] = useState<number | null>(null);
  const [box, setBox] = useState<DOMRect | null>(null);

  useEffect(() => {
    const start = () => setStep(0);
    window.addEventListener("pdftek:tour", start);
    try {
      if (!localStorage.getItem(KEY) && window.innerWidth > 960) {
        const t = setTimeout(start, 900);
        return () => {
          clearTimeout(t);
          window.removeEventListener("pdftek:tour", start);
        };
      }
    } catch {}
    return () => window.removeEventListener("pdftek:tour", start);
  }, []);

  const measure = useCallback(() => {
    if (step === null) return;
    const el = document.querySelector(STOPS[step].sel);
    setBox(el && (el as HTMLElement).offsetParent !== null ? el.getBoundingClientRect() : null);
  }, [step]);
  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const finish = () => {
    setStep(null);
    try {
      localStorage.setItem(KEY, "done");
    } catch {}
  };

  if (step === null) return null;
  const s = STOPS[step];
  const pad = 8;
  const below = !box || box.bottom + 240 < window.innerHeight;
  const left = box ? Math.min(Math.max(16, box.left), window.innerWidth - 376) : window.innerWidth / 2 - 180;
  const top = box ? (below ? box.bottom + 14 : Math.max(16, box.top - 14 - 200)) : window.innerHeight / 2 - 100;

  return (
    <div className="wb-tour" role="dialog" aria-label="Tour">
      {box && <div className="wb-tour-ring" style={{ left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 }} />}
      {!box && <div className="wb-tour-dim" />}
      <div className="wb-tour-card" style={{ left, top }}>
        <div className="wb-tour-n">
          {step + 1} / {STOPS.length}
        </div>
        <b>{s.title}</b>
        <p>{s.text}</p>
        <div className="wb-tour-actions">
          <button className="btn btn-sm btn-ghost" onClick={finish}>
            Skip tour
          </button>
          <span className="grow" />
          {step > 0 && (
            <button className="btn btn-sm" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button className="btn btn-sm btn-primary" onClick={() => (step + 1 < STOPS.length ? setStep(step + 1) : finish())}>
            {step + 1 < STOPS.length ? "Next" : "Done"} {step + 1 < STOPS.length && <I.right size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
}
