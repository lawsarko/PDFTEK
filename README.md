# pdftek

**pdftek is a document workbench for professional teams.** One secure workspace covers uploading, converting, editing, signing, searching and understanding documents. AI answers always cite the page they came from.

![Workbench: library, document viewer, and assistant](docs/workbench.png)

## Features

| Area | What you get |
| --- | --- |
| **Library & knowledge base** | Multi-workspace document library with tags, trash and restore. Every page is indexed with SQLite FTS5, so you can search by file name or full text across all documents, with hit snippets that jump to the page. |
| **Upload anything** | PDF, DOCX/PPTX/XLSX/ODT/RTF (via LibreOffice), TXT/MD/CSV, JPG/PNG/WEBP/HEIC/TIFF, and **camera scanning** with auto-crop and enhance. Also **images → PDF** with drag-to-reorder. |
| **Viewer** | pdf.js rendering with a selectable text layer, lazy page loading, zoom, and citation/search highlighting. |
| **Convert to PDF** | Word (DOC/DOCX/ODT/RTF), Excel (XLS/XLSX/ODS/CSV), PowerPoint (PPT/PPTX/ODP), HTML, text and images to PDF from **Tools → Convert to PDF** or the Convert menu. Several files can be combined into one PDF. Uses LibreOffice with metric-compatible fonts (Carlito for Calibri, Caladea for Cambria, Liberation for Arial/Times), so pages break where they do in Office. |
| **Convert from PDF** | PDF to Word, Excel, PowerPoint, plain text, and JPG/PNG/WEBP/TIFF for all pages or just the current one. Word and Excel exports keep the document's formatting: original fonts (mapped to Office equivalents), sizes, bold/italic, color, centered headings, indents and bullets, right-aligned dates via tab stops or a right-hand column, divider lines, clickable links, line spacing, and page size and margins. Table pages become real Excel grids with numeric cells. |
| **Scans & outlined text** | PDFs without a real text layer (scans, or text exported as vector outlines) are recognized with server-side OCR (Tesseract, English model bundled). Word output places editable text frames exactly over a background of the page's graphics (logos, bands, boxes, rules), with measured sizes, colors and bold; Excel output reproduces the column layout with colored bands as cell fills. |
| **Edit (Pro)** | Click any line to rewrite it in its original typeface (embedded fonts are matched to the same family or a metric-compatible open font), keeping size, bold and italic. Add styled text (font, bold/italic/underline, size, color), place and resize images, highlight, white out, and **truly redact**: redacted pages are flattened to images so the hidden text is gone. Undo/redo, draft autosave, and each save becomes a new version. |
| **AI assistant** | Chat with a document or the **whole library**. Answers stream in with clickable page citations. **Extract** key terms, dates and deadlines, parties, obligations, financial figures, tables, custom fields, and **risk flags checked against your team playbook**. Results export to Excel/CSV. |
| **Compare** | Word-level redline of any two documents or versions, a "changes only" view, and an AI summary of material changes. |
| **E-signatures (Pro)** | Place signature, initials, date, name and text fields for each signer. Signing can be in parallel or in order. Signers draw or type, give consent, and can decline. Reminders are supported. The signed PDF gets a **certificate of completion** listing IP addresses, timestamps, user agents and the original document's SHA-256. |
| **Document requests (Pro)** | Collect files from clients through secure upload links, with due dates, reminders and status tracking (pending → viewed → complete). |
| **Automations (Pro)** | Triggers: document uploaded, schedule (digest), renewal coming up (N days out), signature completed, request fulfilled. Actions: extract, summarize, tag, assign, notify, email, and HTTPS webhooks that are Slack-compatible and blocked from private hosts. Every run is logged. |
| **Teams** | Invites, owner/admin/member roles, check-out locks against conflicting edits, hand-offs with notes, an activity feed, in-app notifications, and email. |
| **Also** | Read aloud (Web Speech, 11 languages, speed control), in-browser OCR (Tesseract, 13 languages), merge, split, extract, delete, rotate, drag-to-organize pages, watermark, page and Bates numbering, **compress** (downsamples and recompresses images; light / recommended / strong; Ghostscript used too when installed), **protect with a password** (AES-256, with print/copy/edit restrictions) and **unlock** password-protected PDFs, metadata, version history with restore. |
| **Business** | Marketing site, pricing, Free/Pro/Business plans, a 14-day trial, and optional Stripe Checkout, Customer Portal and webhooks. |

## Quick start

```bash
cp .env.example .env        # add ANTHROPIC_API_KEY to enable AI features
npm install
npm run dev                 # http://localhost:3000
```

Requires **Node.js 22.13+**, because the database uses the built-in `node:sqlite`.

### Production (Docker)

```bash
docker compose up -d --build
```

The image includes LibreOffice for Office conversions. All state (the SQLite database and uploaded files) lives in the `/data` volume, so back that volume up.

### Render

Word/Excel/PowerPoint → PDF needs LibreOffice, which Render's plain Node runtime doesn't have, so deploy with Docker. Use **New → Blueprint** with this repository (it reads `render.yaml` and creates a Docker web service with a disk at `/data`), or create a **New → Web Service** with **Language: Docker** and add a **Disk** mounted at `/data`. Set `APP_URL`, `DATA_DIR=/data` and `ANTHROPIC_API_KEY` under **Environment**. The **Server capabilities** card in the app's workspace settings shows whether Office conversion is available.

## Configuration

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public base URL, used in emails and share links. |
| `DATA_DIR` | Where the database and files are stored (default `./data`). |
| `ANTHROPIC_API_KEY` | Enables chat, extraction, summaries, compare insights and AI automation steps. |
| `PDFTEK_AI_MODEL` | Overrides the model (default `claude-opus-5`). |
| `SMTP_URL`, `MAIL_FROM` | Outbound email. Without them, emails are logged, and the UI offers copyable links instead. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS` | Online billing. Point the Stripe webhook at `/api/stripe/webhook`. |
| `SOFFICE_PATH` | Custom LibreOffice binary path. It is auto-detected otherwise. |
| `PDFTEK_DISABLE_SCHEDULER=1` | Turns off the in-process automation scheduler, e.g. on extra replicas. |

## Architecture

- **Next.js 15 (App Router) + React 19 + TypeScript.** Route handlers under `src/app/api` return JSON and are wrapped by `route()` (`src/lib/http.ts`), which handles same-origin checks, zod validation and uniform errors.
- **Data:** `node:sqlite` with WAL and FTS5 for page-level full-text search (`src/lib/db.ts`). Files are stored on disk under `DATA_DIR/files` (`src/lib/storage.ts`). Each document version is an immutable file with a SHA-256 hash.
- **Auth:** email and password (scrypt). Sessions are random tokens stored hashed, in an httpOnly SameSite=Lax cookie. Every API call checks workspace membership and role (`requireMember`). Login and signup are rate-limited.
- **PDF engine:** pdf-lib for page operations, stamping, editing and signatures, on both server and client. pdf.js renders in the browser and extracts text on the server. LibreOffice converts Office files.
- **AI:** Anthropic SDK (`src/lib/ai.ts`). PDFs are sent as `document` blocks with citations enabled and prompt caching on the document prefix. Extraction uses structured outputs (JSON schema). Server-side refusal fallbacks are enabled (`fallbacks: "default"`). Library chat retrieves the best pages with FTS5 and sends them as citable documents.
- **Automations:** an in-process scheduler started from `src/instrumentation.ts` ticks every minute. Event triggers fire from uploads, signature completion and fulfilled requests.

## Project layout

```
src/
  app/                 pages (marketing, auth, workbench, settings, tools, compare, sign, request) and API routes
  components/          UI: workbench panes, PDF viewer, editor, signature pad, modals
  lib/                 server modules (db, auth, documents, pdf, ai, signing, automations, mail, stripe)
  lib/client/          browser helpers (api, pdf.js, converters, images)
```

## Scripts

- `npm run dev`: development server
- `npm run build && npm start`: production build and server
- `npm run typecheck`: TypeScript
- `npm run lint`: ESLint
