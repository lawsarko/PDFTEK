"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Doc } from "@/lib/client/types";
import { pageToCanvas, pdfjs } from "@/lib/client/pdf";

/* ---------------------------------------------------------------------------------------------
   Page thumbnails.
   Home: the first page of each document, drawn once in the browser and remembered (by version)
   so the next visit shows them at once. Document view: every page of the open PDF, drawn as
   they scroll into view.
   --------------------------------------------------------------------------------------------- */

const STORE = "pdftek-thumbs";
const memory = new Map<string, string>();
let stored: Record<string, string> | null = null;

function readStore(): Record<string, string> {
  if (stored) return stored;
  try {
    stored = JSON.parse(localStorage.getItem(STORE) || "{}") as Record<string, string>;
  } catch {
    stored = {};
  }
  return stored;
}

function remember(key: string, url: string) {
  memory.set(key, url);
  const s = readStore();
  s[key] = url;
  const keys = Object.keys(s);
  // Keep the most recent 60 so browser storage stays small.
  for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete s[k];
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {}
}

// At most two documents are fetched and drawn at a time.
let running = 0;
const queue: (() => void)[] = [];
function slot<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const go = () => {
      running++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          running--;
          queue.shift()?.();
        });
    };
    if (running < 2) go();
    else queue.push(go);
  });
}

async function firstPage(doc: Doc): Promise<string> {
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ url: `/api/documents/${doc.id}/file?version=${doc.versionId}`, isEvalSupported: false, withCredentials: true }).promise;
  try {
    const page = await pdf.getPage(1);
    const w = page.getViewport({ scale: 1 }).width;
    const canvas = await pageToCanvas(page, 320 / w);
    return canvas.toDataURL("image/jpeg", 0.72);
  } finally {
    void pdf.destroy();
  }
}

/** The first page of a document, or a plain sheet while it draws (or if it can't). */
export function DocThumb({ doc }: { doc: Doc }) {
  const key = `${doc.id}:${doc.versionId}`;
  const [url, setUrl] = useState<string | null>(() => memory.get(key) ?? null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const known = memory.get(key) ?? readStore()[key];
    if (known) {
      memory.set(key, known);
      setUrl(known);
      return;
    }
    setUrl(null);
    const el = box.current;
    if (!el || !doc.versionId) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        slot(() => firstPage(doc))
          .then((u) => {
            remember(key, u);
            if (!cancelled) setUrl(u);
          })
          .catch(() => {});
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div ref={box} className={`wb-thumb-page ${url ? "" : "blank"}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" draggable={false} />
      ) : (
        <>
          <i style={{ width: "70%" }} />
          <i />
          <i />
          <i style={{ width: "85%" }} />
          <i />
          <i style={{ width: "60%" }} />
        </>
      )}
    </div>
  );
}

/** One page of the open document in the pages rail. */
function PageThumb({ pdf, n, on, onPick }: { pdf: PDFDocumentProxy; n: number; on: boolean; onPick: (n: number) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [ratio, setRatio] = useState(1.294);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      async (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        try {
          const page = await pdf.getPage(n);
          const v = page.getViewport({ scale: 1 });
          if (!cancelled) setRatio(v.height / v.width);
          const canvas = await pageToCanvas(page, 168 / v.width);
          if (!cancelled) setUrl(canvas.toDataURL("image/jpeg", 0.75));
        } catch {}
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [pdf, n]);

  useEffect(() => {
    if (on) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [on]);

  return (
    <button ref={ref} className={`wb-pthumb ${on ? "on" : ""}`} onClick={() => onPick(n)} aria-label={`Page ${n}`} aria-current={on ? "page" : undefined}>
      <span className="wb-pthumb-img" style={{ aspectRatio: `1 / ${ratio}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url && <img src={url} alt="" draggable={false} />}
      </span>
      <span className="wb-pthumb-n">{n}</span>
    </button>
  );
}

export function PageRail({ pdf, page, onPick }: { pdf: PDFDocumentProxy | null; page: number; onPick: (n: number) => void }) {
  return (
    <nav className="wb-pages" aria-label="Pages">
      {pdf ? Array.from({ length: pdf.numPages }, (_, i) => <PageThumb key={i} pdf={pdf} n={i + 1} on={page === i + 1} onPick={onPick} />) : <span className="spinner" />}
    </nav>
  );
}
