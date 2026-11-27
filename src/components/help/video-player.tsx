"use client";
import { useEffect, useRef, useState } from "react";
import { I } from "../icons";

export type Cue = { start: number; end: number; step: number; text: string };

const PREFS = "pdftek-help-player";

/**
 * The guide video: a narrated walkthrough with captions drawn over it (in the reader's language).
 * The voice can be muted and the captions hidden independently; both choices are remembered.
 */
export function GuideVideo({
  src,
  poster,
  duration,
  cues,
  title,
  stepTitles,
  labels,
}: {
  src: string;
  poster?: string;
  duration: number;
  cues: Cue[];
  title: string;
  stepTitles: string[];
  labels: { play: string; pause: string; voiceOn: string; voiceOff: string; captionsOn: string; captionsOff: string; fullscreen: string; step: string; replay: string };
}) {
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(true);

  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) || "{}") as { muted?: boolean; captions?: boolean };
      if (p.muted) setMuted(true);
      if (p.captions === false) setCaptions(false);
    } catch {}
  }, []);
  const save = (p: { muted?: boolean; captions?: boolean }) => {
    try {
      const old = JSON.parse(localStorage.getItem(PREFS) || "{}");
      localStorage.setItem(PREFS, JSON.stringify({ ...old, ...p }));
    } catch {}
  };

  useEffect(() => {
    if (video.current) video.current.muted = muted;
  }, [muted]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (ended) v.currentTime = 0;
      void v.play();
    } else v.pause();
  };

  const cue = cues.find((c) => time >= c.start && time < c.end + 0.15);
  const step = cue && cue.step >= 0 ? cue.step : null;
  const pct = Math.min(100, (time / Math.max(1, duration)) * 100);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className="hc-player" ref={box}>
      <video
        ref={video}
        src={src}
        poster={poster}
        preload="metadata"
        playsInline
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
          setEnded(false);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setEnded(true);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onClick={toggle}
      />
      {!started && (
        <button className="hc-player-start" onClick={toggle} aria-label={labels.play}>
          <span className="hc-player-big">
            <I.play size={30} />
          </span>
          <span className="hc-player-title">{title}</span>
          <span className="hc-player-len">{fmt(duration)}</span>
        </button>
      )}
      {ended && (
        <button className="hc-player-start" onClick={toggle} aria-label={labels.replay}>
          <span className="hc-player-big">
            <I.undo size={26} />
          </span>
          <span className="hc-player-title">{labels.replay}</span>
        </button>
      )}
      {started && step !== null && stepTitles[step] && (
        <div className="hc-player-step">
          {labels.step} {step + 1} · {stepTitles[step]}
        </div>
      )}
      {started && captions && cue && !ended && (
        <div className="hc-player-cc" aria-live="polite">
          <span>{cue.text}</span>
        </div>
      )}
      <div className="hc-player-bar">
        <button className="hc-pbtn" onClick={toggle} aria-label={playing ? labels.pause : labels.play}>
          {playing ? <I.pause size={18} /> : <I.play size={18} />}
        </button>
        <div
          className="hc-progress"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          tabIndex={0}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (video.current) video.current.currentTime = ((e.clientX - r.left) / r.width) * duration;
          }}
          onKeyDown={(e) => {
            if (!video.current) return;
            if (e.key === "ArrowRight") video.current.currentTime = Math.min(duration, time + 5);
            if (e.key === "ArrowLeft") video.current.currentTime = Math.max(0, time - 5);
          }}
        >
          <i style={{ width: `${pct}%` }} />
          {cues
            .filter((c, i) => c.step >= 0 && (i === 0 || cues[i - 1].step !== c.step))
            .map((c) => (
              <b key={c.start} style={{ left: `${(c.start / duration) * 100}%` }} />
            ))}
        </div>
        <span className="hc-time">
          {fmt(time)} / {fmt(duration)}
        </span>
        <button
          className={`hc-pbtn hc-pill ${muted ? "off" : ""}`}
          onClick={() => {
            setMuted(!muted);
            save({ muted: !muted });
          }}
          aria-pressed={!muted}
          title={muted ? labels.voiceOff : labels.voiceOn}
        >
          {muted ? <I.speakerOff size={16} /> : <I.speaker size={16} />} <span className="hc-pill-l">{muted ? labels.voiceOff : labels.voiceOn}</span>
        </button>
        <button
          className={`hc-pbtn hc-pill ${captions ? "" : "off"}`}
          onClick={() => {
            setCaptions(!captions);
            save({ captions: !captions });
          }}
          aria-pressed={captions}
          title={captions ? labels.captionsOn : labels.captionsOff}
        >
          <span className="hc-cc">CC</span> <span className="hc-pill-l">{captions ? labels.captionsOn : labels.captionsOff}</span>
        </button>
        <button
          className="hc-pbtn"
          onClick={() => {
            const el = box.current;
            if (!el) return;
            if (document.fullscreenElement) void document.exitFullscreen();
            else if (el.requestFullscreen) void el.requestFullscreen();
            else (video.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.();
          }}
          aria-label={labels.fullscreen}
        >
          <I.fit size={16} />
        </button>
      </div>
    </div>
  );
}
