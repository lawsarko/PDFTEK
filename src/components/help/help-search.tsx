"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { I } from "../icons";

export type SearchItem = { href: string; title: string; summary: string; category: string; text: string; video: boolean };

/** Instant search over every guide (in the reader's language). */
export function HelpSearch({ items, placeholder, noResults, videoLabel }: { items: SearchItem[]; placeholder: string; noResults: string; videoLabel: string }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) return [];
    return items
      .map((it) => {
        const title = it.title.toLowerCase();
        const body = `${it.summary} ${it.text}`.toLowerCase();
        let score = 0;
        for (const w of words) {
          if (title.includes(w)) score += 3;
          else if (body.includes(w)) score += 1;
          else return null;
        }
        return { it, score };
      })
      .filter((x): x is { it: SearchItem; score: number } => !!x)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.it);
  }, [q, items]);

  return (
    <div className="hc-search">
      <label className="hc-search-box">
        <I.search size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoComplete="off" />
      </label>
      {q.trim().length > 1 && (
        <div className="hc-search-results" role="listbox">
          {hits.length === 0 && <div className="hc-search-none">{noResults}</div>}
          {hits.map((h) => (
            <Link key={h.href} href={h.href} className="hc-search-hit" role="option" aria-selected={false}>
              <span className="hc-search-cat">{h.category}</span>
              <b>{h.title}</b>
              <span>{h.summary}</span>
              {h.video && (
                <em>
                  <I.play size={11} /> {videoLabel}
                </em>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
