"""
Builds the narrated Help Center videos.

For each guide: a title card, then each step's screenshot, with a generated voice reading the
summary and steps. Captions are not burned in: their timings go to src/lib/help/videos.json and the
player draws them (in the reader's language), so the voice can be muted and captions turned off.

Needs ffmpeg, and Python with kokoro-onnx, soundfile and numpy, plus the Kokoro model files
(kokoro-v1.0.onnx and voices-v1.0.bin from github.com/thewh1teagle/kokoro-onnx/releases).

Usage:
  python3 scripts/help/video.py --guides guides.json --shots <raw png dir> --cards <card dir> \
      --model <dir with the Kokoro files> [--only slug,slug]
"""

import argparse
import json
import os
import re
import subprocess
import tempfile

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "public", "help", "video")
MANIFEST = os.path.join(ROOT, "src", "lib", "help", "videos.json")
VOICE = "af_heart"
RATE = 24000
LEAD, GAP, TAIL, FADE = 0.45, 0.32, 0.7, 0.5
W, H = 1280, 800


def sentences(text):
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9“\"])", text.strip())
    return [p.strip() for p in parts if p.strip()]


def spoken(text):
    """How a caption should sound (the caption itself is shown as written)."""
    t = text.replace("→", " to ").replace("pdftek", "P D F tek").replace("PDFTEK", "P D F tek")
    t = t.replace("#", "").replace(" / ", " or ")
    t = re.sub(r"\bAI\b", "A.I.", t)
    t = re.sub(r"\bOCR\b", "O C R", t)
    t = t.replace("e-signature", "e signature")
    return t


def slides_for(g, shots, cards):
    card = os.path.join(cards, f"{g['slug']}.png")
    out = [(card, [g["title"] + "."] + sentences(g["summary"]), -1)]
    for i, s in enumerate(g["steps"]):
        img = os.path.join(shots, f"{s['shot']}.png") if s.get("shot") else None
        if not img or not os.path.exists(img):
            img = card
        out.append((img, [s["title"] + "."] + sentences(s["text"]), i))
    out.append((os.path.join(cards, "_outro.png"), ["That’s it.", "Find every guide and video in the pdftek Help Center."], -1))
    return out


def build(g, tts, shots, cards):
    slides = slides_for(g, shots, cards)
    audio_parts = []  # (slide index, [(caption, samples)])
    for idx, (_, lines, _) in enumerate(slides):
        clips = []
        for line in lines:
            samples, sr = tts.create(spoken(line), voice=VOICE, speed=1.0, lang="en-us")
            assert sr == RATE
            clips.append((line, samples.astype(np.float32)))
        audio_parts.append(clips)

    durations, cues, starts = [], [], []
    t = 0.0
    for i, clips in enumerate(audio_parts):
        speech = sum(len(c[1]) for c in clips) / RATE + GAP * (len(clips) - 1)
        d = LEAD + speech + TAIL + (FADE if i else 0)
        start = t - (FADE * i)  # each slide overlaps the previous by the crossfade
        starts.append(start)
        durations.append(d)
        t += d
    total = starts[-1] + durations[-1]

    mix = np.zeros(int((total + 0.5) * RATE), dtype=np.float32)
    for i, clips in enumerate(audio_parts):
        cur = starts[i] + LEAD + (FADE if i else 0)
        for k, (line, samples) in enumerate(clips):
            a = int(cur * RATE)
            mix[a : a + len(samples)] += samples
            end = cur + len(samples) / RATE
            cues.append({"start": round(cur, 2), "end": round(end, 2), "step": slides[i][2], "text": line})
            cur = end + GAP
    peak = float(np.max(np.abs(mix))) or 1.0
    mix = (mix / peak * 0.89).astype(np.float32)

    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "voice.wav")
        sf.write(wav, mix, RATE)
        args = ["ffmpeg", "-y", "-loglevel", "error"]
        for (img, _, _), d in zip(slides, durations):
            args += ["-loop", "1", "-t", f"{d:.3f}", "-i", img]
        args += ["-i", wav]
        prep = ";".join(
            f"[{i}:v]scale=1920:1200:force_original_aspect_ratio=decrease,pad=1920:1200:(ow-iw)/2:(oh-ih)/2:color=0xF3ECE6,setsar=1,fps=15,format=yuv420p[v{i}]"
            for i in range(len(slides))
        )
        chain, last = [], "v0"
        for i in range(1, len(slides)):
            chain.append(f"[{last}][v{i}]xfade=transition=fade:duration={FADE}:offset={starts[i]:.3f}[x{i}]")
            last = f"x{i}"
        filt = prep + ";" + ";".join(chain) + f";[{last}]scale={W}:{H}:flags=lanczos[out]"
        mp4 = os.path.join(OUT, f"{g['slug']}.mp4")
        args += [
            "-filter_complex", filt, "-map", "[out]", "-map", f"{len(slides)}:a",
            "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-r", "15",
            "-c:a", "aac", "-b:a", "48k", "-ac", "1", "-movflags", "+faststart", "-t", f"{total:.3f}", mp4,
        ]
        subprocess.run(args, check=True)
        poster = os.path.join(OUT, f"{g['slug']}.jpg")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", slides[0][0], "-vf", f"scale={W}:{H}", "-q:v", "4", poster], check=True)
    return {"duration": round(total, 2), "cues": cues}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--guides", required=True)
    ap.add_argument("--shots", required=True)
    ap.add_argument("--cards", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    data = json.load(open(a.guides))
    only = set(filter(None, a.only.split(",")))
    tts = Kokoro(os.path.join(a.model, "kokoro-v1.0.onnx"), os.path.join(a.model, "voices-v1.0.bin"))
    manifest = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else {}
    for g in data["guides"]:
        if only and g["slug"] not in only:
            continue
        manifest[g["slug"]] = build(g, tts, a.shots, a.cards)
        size = os.path.getsize(os.path.join(OUT, f"{g['slug']}.mp4")) / 1e6
        print(f"{g['slug']}: {manifest[g['slug']]['duration']}s, {size:.1f} MB", flush=True)
        with open(MANIFEST, "w") as f:
            json.dump(dict(sorted(manifest.items())), f, indent=1)
            f.write("\n")


if __name__ == "__main__":
    main()
