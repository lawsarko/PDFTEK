"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";
import { loadPdf, pdfjs, renderPage } from "@/lib/client/pdf";

export type PageInfo = { page: number; width: number; height: number; scale: number; viewport: PageViewport };
export type Flash = { page: number; text?: string; nonce: number };

type Props = {
  src: string;
  scale: number;
  flash?: Flash | null;
  onLoaded?: (doc: PDFDocumentProxy) => void;
  onVisiblePage?: (page: number) => void;
  onError?: (err: Error) => void;
  renderOverlay?: (info: PageInfo) => React.ReactNode;
  textLayer?: boolean;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
};

export function PdfViewer({ src, scale, flash, onLoaded, onVisiblePage, onError, renderOverlay, textLayer = true, scrollRef }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const localScroll = useRef<HTMLDivElement>(null);
  const container = scrollRef ?? localScroll;

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError(null);
    loadPdf(src)
      .then(async (d) => {
        if (cancelled) return;
        // Pre-compute page sizes for layout (cheap; no rendering).
        const s: { w: number; h: number }[] = [];
        for (let i = 1; i <= d.numPages; i++) {
          const p = await d.getPage(i);
          const v = p.getViewport({ scale: 1 });
          s.push({ w: v.width, h: v.height });
        }
        if (cancelled) return;
        setSizes(s);
        setDoc(d);
        onLoaded?.(d);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError("This PDF couldn't be displayed.");
        onError?.(e);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Track the most visible page.
  useEffect(() => {
    const root = container.current;
    if (!root || !doc || !onVisiblePage) return;
    const handler = () => {
      const pages = root.querySelectorAll<HTMLElement>("[data-page]");
      const mid = root.getBoundingClientRect().top + root.clientHeight / 3;
      let best = 1;
      pages.forEach((el) => {
        if (el.getBoundingClientRect().top <= mid) best = Number(el.dataset.page);
      });
      onVisiblePage(best);
    };
    root.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => root.removeEventListener("scroll", handler);
  }, [doc, container, onVisiblePage]);

  // Scroll to and flash a page (used for citations and search hits).
  useEffect(() => {
    if (!flash || !doc) return;
    const el = container.current?.querySelector<HTMLElement>(`[data-page="${flash.page}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }, [flash, doc, container]);

  if (error) return <div className="empty">{error}</div>;
  if (!doc) {
    return (
      <div className="empty">
        <span className="spinner spinner-lg" />
      </div>
    );
  }

  const content = (
    <div className="page-stack">
      {sizes.map((s, i) => (
        <PdfPage
          key={`${src}-${i}`}
          doc={doc}
          pageNumber={i + 1}
          baseWidth={s.w}
          baseHeight={s.h}
          scale={scale}
          textLayer={textLayer}
          highlight={flash && flash.page === i + 1 ? flash : null}
          renderOverlay={renderOverlay}
          root={container}
        />
      ))}
    </div>
  );
  if (scrollRef) return content;
  return (
    <div className="page-scroll" ref={localScroll}>
      {content}
    </div>
  );
}

function PdfPage({
  doc,
  pageNumber,
  baseWidth,
  baseHeight,
  scale,
  textLayer,
  highlight,
  renderOverlay,
  root,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  baseWidth: number;
  baseHeight: number;
  scale: number;
  textLayer: boolean;
  highlight: Flash | null;
  renderOverlay?: (info: PageInfo) => React.ReactNode;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [textReady, setTextReady] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { root: root.current, rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let textLayerObj: { cancel: () => void } | null = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled || !canvas.current) return;
      const vp = await renderPage(page, canvas.current, scale).catch(() => null);
      if (cancelled || !vp) return;
      setViewport(vp);
      if (textLayer && textRef.current) {
        const lib = await pdfjs();
        textRef.current.replaceChildren();
        textRef.current.style.setProperty("--scale-factor", String(scale));
        const tl = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: textRef.current, viewport: vp });
        textLayerObj = tl;
        await tl.render().catch(() => {});
        if (!cancelled) setTextReady((n) => n + 1);
      }
    })();
    return () => {
      cancelled = true;
      textLayerObj?.cancel();
    };
  }, [visible, doc, pageNumber, scale, textLayer]);

  // Highlight cited text within the text layer.
  useEffect(() => {
    const layer = textRef.current;
    if (!layer) return;
    layer.querySelectorAll(".highlight").forEach((n) => n.classList.remove("highlight"));
    if (!highlight?.text) return;
    const needle = normalize(highlight.text);
    if (needle.length < 4) return;
    let first: HTMLElement | null = null;
    layer.querySelectorAll<HTMLElement>("span").forEach((span) => {
      const t = normalize(span.textContent ?? "");
      if (t.length >= 4 && needle.includes(t)) {
        span.classList.add("highlight");
        first ??= span;
      }
    });
    (first as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight, textReady]);

  const w = Math.floor(baseWidth * scale);
  const h = Math.floor(baseHeight * scale);
  const info = useMemo(() => (viewport ? { page: pageNumber, width: w, height: h, scale, viewport } : null), [viewport, pageNumber, w, h, scale]);

  return (
    <div className="pdf-page" data-page={pageNumber} ref={wrap} style={{ width: w, height: h }}>
      <span className="page-label">{pageNumber}</span>
      <canvas ref={canvas} style={{ width: w, height: h }} />
      {textLayer && <div className="textLayer" ref={textRef} />}
      {info && renderOverlay?.(info)}
    </div>
  );
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
