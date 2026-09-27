"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { Doc } from "@/lib/client/types";
import { I } from "../icons";
import { useWB } from "./context";

const LANGS: [string, string][] = [
  ["en-US", "English (US)"],
  ["en-GB", "English (UK)"],
  ["es-ES", "Spanish"],
  ["fr-FR", "French"],
  ["de-DE", "German"],
  ["pt-BR", "Portuguese"],
  ["it-IT", "Italian"],
  ["zh-CN", "Mandarin"],
  ["ja-JP", "Japanese"],
  ["ar-SA", "Arabic"],
  ["hi-IN", "Hindi"],
];
const SPEEDS = [0.8, 1, 1.25, 1.5, 1.75, 2];

type Sentence = { page: number; text: string };

export function ReadAloud({ doc, startPage, onClose }: { doc: Doc; startPage: number; onClose: () => void }) {
  const { jump } = useWB();
  const [sentences, setSentences] = useState<Sentence[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [lang, setLang] = useState(() => (typeof navigator !== "undefined" && LANGS.find(([c]) => c === navigator.language)?.[0]) || "en-US");
  const [speed, setSpeed] = useState(1);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const idxRef = useRef(0);
  const playingRef = useRef(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    api<{ pages: { page: number; text: string }[] }>(`/api/documents/${doc.id}/text`).then((r) => {
      const list: Sentence[] = [];
      for (const p of r.pages) {
        const flat = p.text.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
        const parts = flat.match(/[^.!?。！？]+[.!?。！？]+["')\]]*|[^.!?。！？]+$/g) ?? [];
        parts.map((s) => s.trim()).filter((s) => s.length > 1).forEach((text) => list.push({ page: p.page, text }));
      }
      setSentences(list);
      const first = list.findIndex((s) => s.page >= startPage);
      idxRef.current = Math.max(0, first);
      setIdx(idxRef.current);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(speechSynthesis.getVoices());
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      speechSynthesis.removeEventListener("voiceschanged", load);
      speechSynthesis.cancel();
    };
  }, [supported]);

  const voice = useMemo(() => voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.slice(0, 2))), [voices, lang]);

  const speak = useCallback(
    (i: number) => {
      if (!sentences || !supported) return;
      speechSynthesis.cancel();
      if (i >= sentences.length) {
        setPlaying(false);
        playingRef.current = false;
        return;
      }
      idxRef.current = i;
      setIdx(i);
      const s = sentences[i];
      if (i === 0 || sentences[i - 1].page !== s.page) jump(s.page);
      const u = new SpeechSynthesisUtterance(s.text);
      u.lang = lang;
      if (voice) u.voice = voice;
      u.rate = speed;
      u.onend = () => {
        if (playingRef.current && idxRef.current === i) speak(i + 1);
      };
      speechSynthesis.speak(u);
    },
    [sentences, supported, lang, voice, speed, jump],
  );

  const toggle = () => {
    if (playing) {
      playingRef.current = false;
      setPlaying(false);
      speechSynthesis.cancel();
    } else {
      playingRef.current = true;
      setPlaying(true);
      speak(idxRef.current);
    }
  };

  // Restart the current sentence when voice settings change mid-playback.
  useEffect(() => {
    if (playingRef.current) speak(idxRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, speed]);

  const step = (d: number) => {
    const n = Math.max(0, Math.min((sentences?.length ?? 1) - 1, idxRef.current + d));
    if (playingRef.current) speak(n);
    else {
      idxRef.current = n;
      setIdx(n);
    }
  };

  const cur = sentences?.[idx];
  return (
    <div className="tts-bar" role="region" aria-label="Read aloud">
      {!supported ? (
        <div className="small">Your browser doesn’t support speech synthesis.</div>
      ) : !sentences ? (
        <span className="spinner" />
      ) : sentences.length === 0 ? (
        <div className="small muted">No readable text in this document yet — run OCR first.</div>
      ) : (
        <div className="tts-text">
          <span className="mono tiny faint">p.{cur?.page} · </span>
          <mark>{cur?.text}</mark> <span>{sentences[idx + 1]?.text}</span>
        </div>
      )}
      <div className="row wrap">
        <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous sentence">
          <I.left size={16} />
        </button>
        <button className="btn btn-primary btn-sm" onClick={toggle} disabled={!sentences?.length} style={{ minWidth: 84 }}>
          {playing ? <I.pause size={14} /> : <I.play size={14} />} {playing ? "Pause" : "Play"}
        </button>
        <button className="icon-btn" onClick={() => step(1)} aria-label="Next sentence">
          <I.right size={16} />
        </button>
        <select className="select input-sm" style={{ width: "auto" }} value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
          {LANGS.map(([c, l]) => (
            <option key={c} value={c}>
              {l}
            </option>
          ))}
        </select>
        <button className="tool-btn" onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])} aria-label="Playback speed">
          {speed.toFixed(2).replace(/0$/, "")}×
        </button>
        <span className="grow" />
        {sentences && sentences.length > 0 && (
          <span className="mono tiny faint">
            {idx + 1}/{sentences.length}
          </span>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Close read aloud">
          <I.x size={16} />
        </button>
      </div>
      {voices.length > 0 && !voice && <div className="tiny faint">No {LANGS.find(([c]) => c === lang)?.[1]} voice is installed on this device; your browser will use its default.</div>}
    </div>
  );
}
