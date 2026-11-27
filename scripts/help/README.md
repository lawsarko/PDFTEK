# Help Center screenshots and videos

The guides live in `src/lib/help/guides.ts`. Each step names a screenshot (`shot`), and each guide
has a narrated video. These scripts rebuild both from the real app, so they stay accurate after the
design changes.

1. **Sample documents** (fictional): `node scripts/help/samples.cjs <samples dir>`
2. **A pdftek server for capturing**, with fresh data, a mock AI and an email catcher. Start these
   before step 3:
   ```
   node scripts/help/smtp-sink.cjs 2526 <mail dir> &
   node scripts/help/mock-ai.cjs 4011 &
   DATA_DIR=<empty dir> APP_URL=http://localhost:3200 SMTP_URL=smtp://localhost:2526 \
   ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:4011 \
   GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=x GOOGLE_API_KEY=x DROPBOX_APP_KEY=x DROPBOX_APP_SECRET=x \
   MICROSOFT_CLIENT_ID=x MICROSOFT_CLIENT_SECRET=x INBOUND_EMAIL_DOMAIN=in.pdftek.com INBOUND_EMAIL_SECRET=x \
   STRIPE_SECRET_KEY=sk_test_placeholder PDFTEK_FAKE_PAYMENTS=1 npx next start -p 3200
   ```
3. **Screenshots**: `node scripts/help/capture.cjs --base http://localhost:3200 --db <DATA_DIR>/pdftek.db --samples <samples dir> --mail <mail dir> --out <raw dir>`
   (add `--only home,tools` to redo some sections; put a `camera.y4m` in the raw dir for the scanner).
   Then `node scripts/help/finish.cjs <raw dir>` writes `public/help/shots/*.webp`.
4. **Videos**: `npx tsx scripts/help/guides-json.mts > guides.json`,
   `node scripts/help/cards.cjs guides.json <cards dir>`, then
   `python3 scripts/help/video.py --guides guides.json --shots <raw dir> --cards <cards dir> --model <kokoro dir>`.
   This writes `public/help/video/<slug>.mp4` and `.jpg`, and the caption timings in
   `src/lib/help/videos.json`. The voice is Kokoro (`af_heart`), which runs offline
   (`pip install kokoro-onnx soundfile`; model files from github.com/thewh1teagle/kokoro-onnx/releases).

Captions are drawn by the player from `videos.json`, in the reader's language, so the voice can be
muted and captions turned off independently.
