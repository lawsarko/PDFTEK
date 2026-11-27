import "server-only";
import fs from "node:fs";
import path from "node:path";
import VIDEOS from "./videos.json";

/** A narrated guide video (made by scripts/help/video.py): its length and caption timings. */
export type VideoInfo = {
  duration: number;
  /** English narration, one cue per sentence; `step` is -1 for the introduction. */
  cues: { start: number; end: number; step: number; text: string }[];
};

export function videoFor(slug: string): VideoInfo | null {
  return (VIDEOS as Record<string, VideoInfo>)[slug] ?? null;
}

const SHOTS = path.join(process.cwd(), "public", "help", "shots");
let shots: Set<string> | null = null;

/** Screenshots that exist (a guide step without one simply shows its text). */
export function hasShot(name?: string) {
  if (!name) return false;
  if (!shots) {
    try {
      shots = new Set(fs.readdirSync(SHOTS).map((f) => f.replace(/\.webp$/, "")));
    } catch {
      shots = new Set();
    }
  }
  return shots.has(name);
}
