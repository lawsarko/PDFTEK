"use client";
/**
 * Marketing-page motion: kinetic type, scroll reveals, count-ups, cursor spotlight and a live
 * product demo. Pure React + CSS (no animation library), and every effect is skipped when the
 * visitor has asked the OS for reduced motion.
 */
import { useEffect, useRef, useState } from "react";

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Calls back once the element scrolls into view. */
function useInView<T extends Element>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion() || !("IntersectionObserver" in window)) return setSeen(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen] as const;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Types each word, pauses, deletes it, and moves on. Renders the last word statically for SSR. */
export function Typewriter({ words, className }: { words: string[]; className?: string }) {
  const [text, setText] = useState(words[words.length - 1]);
  useEffect(() => {
    if (reducedMotion()) return;
    let alive = true;
    (async () => {
      await sleep(1400);
      let i = 0;
      let cur = words[words.length - 1];
      while (alive) {
        for (let n = cur.length; n >= 0 && alive; n--) {
          setText(cur.slice(0, n));
          await sleep(45);
        }
        cur = words[i++ % words.length];
        await sleep(250);
        for (let n = 1; n <= cur.length && alive; n++) {
          setText(cur.slice(0, n));
          await sleep(85 + Math.random() * 60);
        }
        await sleep(cur === words[words.length - 1] ? 3200 : 1700);
      }
    })();
    return () => {
      alive = false;
    };
  }, [words]);
  return (
    <span className={className}>
      {text}
      <span className="tw-caret" aria-hidden />
    </span>
  );
}

/** Fades and lifts its children in when scrolled into view. */
export function Reveal({ children, delay = 0, className = "", as: Tag = "div", style }: { children: React.ReactNode; delay?: number; className?: string; as?: "div" | "section" | "li"; style?: React.CSSProperties }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.15);
  return (
    <Tag ref={ref as React.Ref<never>} className={`reveal ${seen ? "in" : ""} ${className}`} style={{ ...style, transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

/** Counts from 0 to `to` (ease-out) once visible. */
export function CountUp({ to, suffix = "", duration = 1400 }: { to: number; suffix?: string; duration?: number }) {
  const [ref, seen] = useInView<HTMLSpanElement>(0.5);
  const [n, setN] = useState(to);
  useEffect(() => {
    if (!seen || reducedMotion()) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    setN(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, to, duration]);
  return (
    <span ref={ref}>
      {n}
      {suffix}
    </span>
  );
}

/** Cards inside get a glow that follows the cursor (reads --mx/--my in CSS). */
export function Spotlight({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    const move = (e: PointerEvent) => {
      for (const card of el.querySelectorAll<HTMLElement>(".mk-card")) {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - r.left}px`);
        card.style.setProperty("--my", `${e.clientY - r.top}px`);
      }
    };
    el.addEventListener("pointermove", move);
    return () => el.removeEventListener("pointermove", move);
  }, []);
  return (
    <div ref={ref} className={`spotlight ${className}`}>
      {children}
    </div>
  );
}

/** Thin amber bar at the top showing how far down the page you are. */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const h = document.documentElement;
        const p = h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight);
        if (ref.current) ref.current.style.transform = `scaleX(${p})`;
      });
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return <div ref={ref} className="scroll-progress" aria-hidden />;
}

/** The product screenshot tilts back in 3D and flattens as you scroll it into place. */
export function TiltOnScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.75)));
        el.style.transform = `perspective(1400px) rotateX(${(1 - p) * 22}deg) scale(${0.92 + p * 0.08})`;
        el.style.opacity = String(0.45 + p * 0.55);
      });
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, []);
  return (
    <div ref={ref} className="tilt">
      {children}
    </div>
  );
}

/** Lights up workflow steps one after another, on a loop, once visible. */
export function FlowSequence({ steps, note }: { steps: string[]; note: string }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.4);
  const [on, setOn] = useState(steps.length);
  useEffect(() => {
    if (!seen || reducedMotion()) return;
    let i = 0;
    setOn(0);
    const t = setInterval(() => setOn(((i = (i + 1) % (steps.length + 2)), Math.min(i, steps.length))), 700);
    return () => clearInterval(t);
  }, [seen, steps.length]);
  return (
    <div ref={ref}>
      <div className="flow-steps">
        {steps.map((s, i) => (
          <span key={s} className="row" style={{ gap: 8 }}>
            {i > 0 && <span className={`flow-arrow ${on > i ? "lit" : ""}`}>→</span>}
            <span className={`flow-step ${on > i ? "lit" : ""}`}>{s}</span>
          </span>
        ))}
      </div>
      <div className="tiny mono faint mt-8">{note}</div>
    </div>
  );
}

const CONVERSIONS: [string, string, string][] = [
  ["Q3 report", "DOCX", "PDF"],
  ["Contract", "PDF", "DOCX"],
  ["Budget", "PDF", "XLSX"],
  ["Pitch deck", "PPTX", "PDF"],
  ["Receipt scan", "JPG", "PDF"],
];

/** A file card that visibly converts from one format to another, cycling through examples. */
export function ConvertDemo() {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<"from" | "working" | "to">("to");
  useEffect(() => {
    if (!seen || reducedMotion()) return;
    let alive = true;
    (async () => {
      let k = 0;
      while (alive) {
        setI(k % CONVERSIONS.length);
        setPhase("from");
        await sleep(900);
        if (!alive) break;
        setPhase("working");
        await sleep(1300);
        if (!alive) break;
        setPhase("to");
        await sleep(1700);
        k++;
      }
    })();
    return () => {
      alive = false;
    };
  }, [seen]);
  const [name, from, to] = CONVERSIONS[i];
  const fmt = phase === "to" ? to : from;
  return (
    <div ref={ref} className="convert-demo">
      <div className={`cd-file ${phase}`}>
        <div className={`cd-badge fmt-${fmt.toLowerCase()}`}>{fmt}</div>
        <div className="cd-lines">
          <i style={{ width: "70%" }} />
          <i />
          <i style={{ width: "85%" }} />
          <i style={{ width: "60%" }} />
          <i style={{ width: "90%" }} />
        </div>
        <div className="cd-name">
          {name}.{fmt.toLowerCase()}
        </div>
        <div className="cd-scan" />
      </div>
      <div className="cd-caption mono">
        {from} <span className="cd-arrow">→</span> {to}
        <span className={`cd-status ${phase}`}>{phase === "working" ? "converting…" : phase === "to" ? "✓ formatting kept" : "ready"}</span>
      </div>
    </div>
  );
}

const DEMO = [
  { q: "What’s our exit path if we just want out, no cause needed?", a: "You can terminate for convenience with 90 days’ written notice. No breach is required.", cite: "p.2" },
  { q: "When does this contract auto-renew?", a: "It renews every 24 months unless either party gives notice at least 60 days before the term ends.", cite: "p.2" },
  { q: "Is there a liability cap?", a: "Yes. Liability is capped at the fees paid in the prior 12 months, except for confidentiality breaches.", cite: "p.9" },
];

/** Chat column of the product shot: the question types itself, then the cited answer streams in. */
export function LiveChat() {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  const [k, setK] = useState(0);
  const [q, setQ] = useState(DEMO[0].q);
  const [a, setA] = useState(DEMO[0].a);
  const [thinking, setThinking] = useState(false);
  const [cite, setCite] = useState(true);
  useEffect(() => {
    if (!seen || reducedMotion()) return;
    let alive = true;
    (async () => {
      await sleep(1500);
      let i = 0;
      while (alive) {
        const d = DEMO[i % DEMO.length];
        setK(i % DEMO.length);
        setQ("");
        setA("");
        setCite(false);
        for (let n = 1; n <= d.q.length && alive; n++) {
          setQ(d.q.slice(0, n));
          await sleep(28 + Math.random() * 30);
        }
        setThinking(true);
        await sleep(900);
        setThinking(false);
        const words = d.a.split(" ");
        for (let n = 1; n <= words.length && alive; n++) {
          setA(words.slice(0, n).join(" "));
          await sleep(55 + Math.random() * 50);
        }
        setCite(true);
        await sleep(3600);
        i++;
      }
    })();
    return () => {
      alive = false;
    };
  }, [seen]);
  return (
    <div ref={ref} className="col" style={{ gap: 10 }} data-demo={k}>
      {q && <div className="msg msg-user" style={{ fontSize: 12 }}>{q}</div>}
      {thinking && (
        <div className="msg msg-ai typing-dots" style={{ fontSize: 12 }}>
          <i />
          <i />
          <i />
        </div>
      )}
      {a && (
        <div className="msg msg-ai" style={{ fontSize: 12 }}>
          {a}
          {cite && <span className="cite pop">↳ {DEMO[k].cite}</span>}
        </div>
      )}
    </div>
  );
}
