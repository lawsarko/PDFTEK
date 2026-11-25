/**
 * PDFTEK's tool icons: one illustrated icon per tool, drawn in SVG so they stay sharp at any size and
 * cost nothing to load. Every icon follows the same recipe so the set reads as one family:
 *
 *   a glossy tile in the tool family's colour → a paper sheet showing what goes in → a round badge
 *   showing what you get (a format, or the tool's action).
 *
 * Purely decorative (aria-hidden): the tool's name is always written next to it.
 */

type Pair = readonly [string, string];

/** Tool families: tile gradients (light → deep). */
export const PALETTE = {
  pdf: ["#ff7a7a", "#d92d43"],
  word: ["#6aa8ff", "#2459db"],
  excel: ["#45e08e", "#11905a"],
  ppt: ["#ffae66", "#e2531c"],
  image: ["#c79bff", "#7436e6"],
  ai: ["#ffc24f", "#f2457f"],
  sign: ["#35e6cb", "#0c8f86"],
  secure: ["#97a0ff", "#4a40dd"],
  organize: ["#52d4ff", "#1876dc"],
  compress: ["#ff86c0", "#b622d0"],
  form: ["#ffd76a", "#ef8b0c"],
  edit: ["#ffab70", "#f04d86"],
  ocr: ["#b5ec4f", "#3f9419"],
  translate: ["#6fb5ff", "#7a3cf0"],
  compare: ["#62ecd8", "#2f73e8"],
  cloud: ["#6cc0ff", "#3b62ee"],
  mail: ["#ff9cbc", "#d93b76"],
  scan: ["#ffd86a", "#ee7d07"],
} as const satisfies Record<string, Pair>;
type Family = keyof typeof PALETTE;

/** Format colours for the labels on the paper and the badges. */
const FORMAT: Record<string, string> = { PDF: "#e0364a", DOC: "#2b64e0", XLS: "#14975d", CSV: "#14975d", PPT: "#e65a22", JPG: "#7a3be8", TIF: "#5b6cf0" };

type Paper =
  | { kind: "lines" }
  | { kind: "label"; text: string }
  | { kind: "ledger" }
  | { kind: "invoice" }
  | { kind: "receipt" }
  | { kind: "stack" }
  | { kind: "image" }
  | { kind: "double" }
  | { kind: "cut" }
  | { kind: "tilted" }
  | { kind: "numbered" }
  | { kind: "form" }
  | { kind: "signline" }
  | { kind: "draft" }
  | { kind: "pay" }
  | { kind: "glyphs" };

type Glyph =
  | "arrow" | "merge" | "scissors" | "grid" | "rotate" | "hash" | "compress" | "lock" | "unlock" | "drop" | "pen" | "signature"
  | "check" | "scan" | "speaker" | "chat" | "sparkle" | "globe" | "compare" | "camera" | "table" | "layers" | "inbox" | "link"
  | "cloud" | "mail" | "copy";
type Badge = { glyph: Glyph } | { text: string };

type Spec = { family: Family; paper: Paper; badge: Badge };

const label = (text: string): Paper => ({ kind: "label", text });

/** One entry per tool page (by slug). */
const SPECS: Record<string, Spec> = {
  "pdf-to-word": { family: "word", paper: label("PDF"), badge: { text: "DOC" } },
  "pdf-to-excel": { family: "excel", paper: label("PDF"), badge: { text: "XLS" } },
  "bank-statement-to-excel": { family: "excel", paper: { kind: "ledger" }, badge: { text: "XLS" } },
  "invoice-to-excel": { family: "excel", paper: { kind: "invoice" }, badge: { text: "XLS" } },
  "bank-statement-to-csv": { family: "excel", paper: { kind: "ledger" }, badge: { text: "CSV" } },
  "receipt-to-excel": { family: "excel", paper: { kind: "receipt" }, badge: { text: "XLS" } },
  "bulk-pdf-converter": { family: "excel", paper: { kind: "stack" }, badge: { glyph: "layers" } },
  "request-documents": { family: "sign", paper: { kind: "lines" }, badge: { glyph: "inbox" } },
  "pdf-to-powerpoint": { family: "ppt", paper: label("PDF"), badge: { text: "PPT" } },
  "pdf-to-jpg": { family: "image", paper: label("PDF"), badge: { text: "JPG" } },
  "word-to-pdf": { family: "pdf", paper: label("DOC"), badge: { text: "PDF" } },
  "excel-to-pdf": { family: "pdf", paper: label("XLS"), badge: { text: "PDF" } },
  "powerpoint-to-pdf": { family: "pdf", paper: label("PPT"), badge: { text: "PDF" } },
  "tiff-to-pdf": { family: "pdf", paper: label("TIF"), badge: { text: "PDF" } },
  "jpg-to-pdf": { family: "pdf", paper: { kind: "image" }, badge: { text: "PDF" } },
  "scan-to-pdf": { family: "scan", paper: { kind: "lines" }, badge: { glyph: "camera" } },
  "merge-pdf": { family: "organize", paper: { kind: "double" }, badge: { glyph: "merge" } },
  "split-pdf": { family: "organize", paper: { kind: "cut" }, badge: { glyph: "scissors" } },
  "organize-pdf": { family: "organize", paper: { kind: "lines" }, badge: { glyph: "grid" } },
  "rotate-pdf": { family: "organize", paper: { kind: "tilted" }, badge: { glyph: "rotate" } },
  "add-page-numbers-to-pdf": { family: "organize", paper: { kind: "numbered" }, badge: { glyph: "hash" } },
  "compress-pdf": { family: "compress", paper: { kind: "lines" }, badge: { glyph: "compress" } },
  "protect-pdf": { family: "secure", paper: { kind: "lines" }, badge: { glyph: "lock" } },
  "unlock-pdf": { family: "secure", paper: { kind: "lines" }, badge: { glyph: "unlock" } },
  "watermark-pdf": { family: "secure", paper: { kind: "draft" }, badge: { glyph: "drop" } },
  "fill-pdf-form": { family: "form", paper: { kind: "form" }, badge: { glyph: "check" } },
  "edit-pdf": { family: "edit", paper: { kind: "lines" }, badge: { glyph: "pen" } },
  "sign-pdf": { family: "sign", paper: { kind: "signline" }, badge: { glyph: "signature" } },
  "ocr-pdf": { family: "ocr", paper: { kind: "lines" }, badge: { glyph: "scan" } },
  "read-pdf-aloud": { family: "ai", paper: { kind: "lines" }, badge: { glyph: "speaker" } },
  "chat-with-pdf": { family: "ai", paper: { kind: "lines" }, badge: { glyph: "chat" } },
  "translate-pdf": { family: "translate", paper: { kind: "glyphs" }, badge: { glyph: "globe" } },
  "compare-pdf": { family: "compare", paper: { kind: "double" }, badge: { glyph: "compare" } },
  "esignature-templates": { family: "sign", paper: { kind: "double" }, badge: { glyph: "copy" } },
  "signing-link-with-payment": { family: "sign", paper: { kind: "pay" }, badge: { glyph: "link" } },
  "google-drive-dropbox-onedrive-pdf": { family: "cloud", paper: { kind: "lines" }, badge: { glyph: "cloud" } },
  "email-to-pdf": { family: "mail", paper: { kind: "lines" }, badge: { glyph: "mail" } },
};

const FALLBACK: Spec = { family: "pdf", paper: { kind: "lines" }, badge: { glyph: "sparkle" } };

export const toolColor = (slug: string) => PALETTE[(SPECS[slug] ?? FALLBACK).family][1];

const INK = "#c9d3e3";
const FONT = "Inter, 'Segoe UI', Arial, sans-serif";

/** Grey text lines on the paper. */
function Lines({ y, widths }: { y: number; widths: number[] }) {
  return (
    <>
      {widths.map((w, i) => (
        <rect key={i} x={20} y={y + i * 5} width={w} height={2.2} rx={1.1} fill={INK} />
      ))}
    </>
  );
}

function PaperContent({ paper, deep }: { paper: Paper; deep: string }) {
  switch (paper.kind) {
    case "label":
      return (
        <>
          <rect x={19} y={23} width={21} height={11} rx={3} fill={FORMAT[paper.text] ?? deep} />
          <text x={29.5} y={31} textAnchor="middle" fontFamily={FONT} fontWeight={800} fontSize={7} fill="#fff" letterSpacing={0.2}>
            {paper.text}
          </text>
          <Lines y={38} widths={[18, 13]} />
        </>
      );
    case "ledger":
      return (
        <>
          {[19, 25, 31, 37].map((y, i) => (
            <g key={y}>
              <rect x={19.5} y={y} width={10} height={2.2} rx={1.1} fill={INK} />
              <rect x={32} y={y} width={7} height={2.2} rx={1.1} fill={i % 2 ? "#e0364a" : "#14975d"} opacity={0.85} />
            </g>
          ))}
        </>
      );
    case "invoice":
      return (
        <>
          <rect x={19.5} y={18} width={9} height={3} rx={1.5} fill={deep} opacity={0.8} />
          <Lines y={25} widths={[18, 18, 18]} />
          <rect x={27} y={40} width={12} height={3.2} rx={1.6} fill={deep} />
        </>
      );
    case "receipt":
      return (
        <>
          <rect x={23} y={18} width={13} height={2.2} rx={1.1} fill={deep} opacity={0.75} />
          <Lines y={25} widths={[16, 12, 16]} />
          <path d="M19 41 h20" stroke={INK} strokeWidth={1.2} strokeDasharray="2 2" />
        </>
      );
    case "image":
      return (
        <>
          <rect x={19} y={19} width={20} height={17} rx={3} fill="#e8eefb" />
          <circle cx={34} cy={24} r={2.6} fill="#ffc24f" />
          <path d="M19.5 34.5 l6 -7 4.5 5 3 -3 5.5 5.5 v1 h-19 z" fill="#7c4be8" opacity={0.85} />
          <Lines y={40} widths={[14]} />
        </>
      );
    case "cut":
      return (
        <>
          <Lines y={18} widths={[18, 13]} />
          <path d="M16.5 30 h29" stroke={deep} strokeWidth={1.5} strokeDasharray="2.6 2.2" strokeLinecap="round" />
          <Lines y={35} widths={[18, 11]} />
        </>
      );
    case "numbered":
      return (
        <>
          <Lines y={18} widths={[18, 18, 13, 16]} />
          <circle cx={29.5} cy={42} r={3.4} fill={deep} />
          <text x={29.5} y={44.4} textAnchor="middle" fontFamily={FONT} fontWeight={800} fontSize={5.4} fill="#fff">
            1
          </text>
        </>
      );
    case "form":
      return (
        <>
          {[19, 27, 35].map((y, i) => (
            <g key={y}>
              <rect x={19.5} y={y} width={5} height={5} rx={1.4} fill="none" stroke={i < 2 ? deep : INK} strokeWidth={1.4} />
              {i < 2 && <path d={`M20.6 ${y + 2.6} l1.3 1.3 2.2 -2.6`} stroke={deep} strokeWidth={1.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
              <rect x={27} y={y + 1.4} width={i === 2 ? 8 : 12} height={2.2} rx={1.1} fill={INK} />
            </g>
          ))}
        </>
      );
    case "signline":
      return (
        <>
          <Lines y={18} widths={[18, 14, 18]} />
          <path d="M20.5 38.5 c2 -4 3.5 -4 4 -1.4 s1.6 2 3 -0.6 1.6 -1.6 3 0.6" stroke={deep} strokeWidth={1.4} fill="none" strokeLinecap="round" />
          <path d="M20 41.5 h17" stroke={INK} strokeWidth={1.2} />
        </>
      );
    case "draft":
      return (
        <>
          <Lines y={18} widths={[18, 14, 18, 12]} />
          <text x={28} y={35} textAnchor="middle" fontFamily={FONT} fontWeight={800} fontSize={5.2} fill={deep} opacity={0.38} transform="rotate(-26 28 33)">
            DRAFT
          </text>
        </>
      );
    case "pay":
      return (
        <>
          <Lines y={18} widths={[18, 12]} />
          <rect x={19} y={30} width={14} height={9} rx={2.6} fill="#14975d" />
          <text x={26} y={36.8} textAnchor="middle" fontFamily={FONT} fontWeight={800} fontSize={6.5} fill="#fff">
            $
          </text>
        </>
      );
    case "glyphs":
      return (
        <>
          <text x={21} y={29} fontFamily={FONT} fontWeight={800} fontSize={9} fill={deep}>
            Aa
          </text>
          <text x={27} y={40} fontFamily="'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" fontWeight={700} fontSize={8.5} fill="#7a3cf0">
            文
          </text>
          <Lines y={43} widths={[10]} />
        </>
      );
    default:
      return <Lines y={19} widths={[18, 13, 18, 15]} />;
  }
}

/** Badge glyphs, drawn in a 12×12 box around the badge centre (46, 46). */
function GlyphPath({ g, color }: { g: Glyph; color: string }) {
  const s = { stroke: color, strokeWidth: 2, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (g) {
    case "arrow":
      return <path d="M41 46 h10 M47 42 l4 4 -4 4" {...s} />;
    case "merge":
      return <path d="M41 42 l4.5 4 l-4.5 4 M45.5 46 h5.5 M48.5 43.5 l2.5 2.5 -2.5 2.5" {...s} />;
    case "scissors":
      return (
        <g {...s}>
          <circle cx={42.6} cy={42.8} r={1.9} />
          <circle cx={42.6} cy={49.2} r={1.9} />
          <path d="M44.2 44 L51 49.5 M44.2 48 L51 42.5" />
        </g>
      );
    case "grid":
      return (
        <g {...s} strokeWidth={1.7}>
          <rect x={40.8} y={40.8} width={4.4} height={4.4} rx={1} />
          <rect x={46.8} y={40.8} width={4.4} height={4.4} rx={1} />
          <rect x={40.8} y={46.8} width={4.4} height={4.4} rx={1} />
          <rect x={46.8} y={46.8} width={4.4} height={4.4} rx={1} />
        </g>
      );
    case "rotate":
      return <path d="M50.6 47.2 a4.8 4.8 0 1 1 -1.2 -4.6 M50 39.8 v3.6 h-3.6" {...s} />;
    case "hash":
      return <path d="M44.2 40.8 l-1.4 10.4 M49.2 40.8 l-1.4 10.4 M41 44.2 h10.2 M40.6 48 h10.2" {...s} strokeWidth={1.8} />;
    case "compress":
      return <path d="M41.5 41.5 l3.5 3.5 M45 41.8 v3.2 h-3.2 M50.5 50.5 l-3.5 -3.5 M47 50.2 v-3.2 h3.2" {...s} />;
    case "lock":
      return (
        <g>
          <rect x={41} y={45} width={10} height={6.8} rx={1.6} fill={color} />
          <path d="M43.4 45 v-2.2 a2.6 2.6 0 0 1 5.2 0 v2.2" {...s} strokeWidth={1.8} />
        </g>
      );
    case "unlock":
      return (
        <g>
          <rect x={41} y={45} width={10} height={6.8} rx={1.6} fill={color} />
          <path d="M43.4 45 v-2.2 a2.6 2.6 0 0 1 5.1 -0.6" {...s} strokeWidth={1.8} />
        </g>
      );
    case "drop":
      return <path d="M46 40.4 c2.6 3 4.6 5.4 4.6 7.6 a4.6 4.6 0 0 1 -9.2 0 c0 -2.2 2 -4.6 4.6 -7.6 z" fill={color} />;
    case "pen":
      return <path d="M41.6 50.4 l0.9 -3.4 6.4 -6.4 2.5 2.5 -6.4 6.4 z M47.4 42.1 l2.5 2.5" {...s} strokeWidth={1.8} />;
    case "signature":
      return <path d="M40.4 48.6 c2.2 -6.4 3.8 -6.4 4.3 -2.2 s1.6 3 3.1 -1 1.7 -2.1 3.4 1.1 M41 51.2 h10" {...s} strokeWidth={1.8} />;
    case "check":
      return <path d="M41.2 46.4 l3.2 3.2 6.4 -7" {...s} strokeWidth={2.4} />;
    case "scan":
      return <path d="M41 44 v-2.6 a0.6 0.6 0 0 1 0.6 -0.6 h2.6 M47.8 40.8 h2.6 a0.6 0.6 0 0 1 0.6 0.6 v2.6 M51 48 v2.6 a0.6 0.6 0 0 1 -0.6 0.6 h-2.6 M44.2 51.2 h-2.6 a0.6 0.6 0 0 1 -0.6 -0.6 v-2.6 M42.6 46 h6.8" {...s} strokeWidth={1.8} />;
    case "speaker":
      return (
        <g>
          <path d="M40.8 44.2 h2.6 l3.6 -3 v9.6 l-3.6 -3 h-2.6 z" fill={color} />
          <path d="M49.2 43.6 a3.4 3.4 0 0 1 0 4.8" {...s} strokeWidth={1.8} />
        </g>
      );
    case "chat":
      return <path d="M42.4 41 h7.2 a1.6 1.6 0 0 1 1.6 1.6 v5 a1.6 1.6 0 0 1 -1.6 1.6 h-3.8 l-3.2 2.6 v-2.6 a1.6 1.6 0 0 1 -1.8 -1.6 v-5 a1.6 1.6 0 0 1 1.6 -1.6 z" fill={color} />;
    case "sparkle":
      return <path d="M46 39.8 l1.5 4.7 4.7 1.5 -4.7 1.5 -1.5 4.7 -1.5 -4.7 -4.7 -1.5 4.7 -1.5 z" fill={color} />;
    case "globe":
      return (
        <g {...s} strokeWidth={1.6}>
          <circle cx={46} cy={46} r={5.4} />
          <ellipse cx={46} cy={46} rx={2.4} ry={5.4} />
          <path d="M40.8 46 h10.4" />
        </g>
      );
    case "compare":
      return (
        <g {...s} strokeWidth={1.7}>
          <rect x={40.8} y={41.2} width={4.4} height={9.6} rx={1.1} />
          <rect x={46.8} y={41.2} width={4.4} height={9.6} rx={1.1} fill={color} />
        </g>
      );
    case "camera":
      return (
        <g>
          <path d="M42.2 43 h1.6 l1.1 -1.7 h2.2 l1.1 1.7 h1.6 a1.4 1.4 0 0 1 1.4 1.4 v5.4 a1.4 1.4 0 0 1 -1.4 1.4 h-7.6 a1.4 1.4 0 0 1 -1.4 -1.4 v-5.4 a1.4 1.4 0 0 1 1.4 -1.4 z" fill={color} />
          <circle cx={46} cy={47.1} r={2.1} fill="#fff" />
        </g>
      );
    case "table":
      return (
        <g {...s} strokeWidth={1.6}>
          <rect x={40.8} y={41.8} width={10.4} height={8.4} rx={1.2} />
          <path d="M40.8 44.8 h10.4 M40.8 47.6 h10.4 M44.6 41.8 v8.4" />
        </g>
      );
    case "layers":
      return <path d="M46 40.8 l5.2 2.6 -5.2 2.6 -5.2 -2.6 z M40.8 46.4 l5.2 2.6 5.2 -2.6 M40.8 49.2 l5.2 2.6 5.2 -2.6" {...s} strokeWidth={1.7} />;
    case "inbox":
      return <path d="M40.8 47 l2 -5.4 h6.4 l2 5.4 v3.2 a1 1 0 0 1 -1 1 h-8.4 a1 1 0 0 1 -1 -1 z M40.8 47 h3 l1 1.6 h2.4 l1 -1.6 h3" {...s} strokeWidth={1.6} />;
    case "link":
      return <path d="M44.6 47.4 l2.8 -2.8 M46 43.2 l1.2 -1.2 a2.6 2.6 0 0 1 3.7 3.7 l-1.2 1.2 M46 48.8 l-1.2 1.2 a2.6 2.6 0 0 1 -3.7 -3.7 l1.2 -1.2" {...s} strokeWidth={1.8} />;
    case "cloud":
      return <path d="M43.6 50.2 h6.4 a3.1 3.1 0 0 0 0.3 -6.2 a4.1 4.1 0 0 0 -7.8 -0.8 a3.5 3.5 0 0 0 1.1 7 z" fill={color} />;
    case "mail":
      return (
        <g {...s} strokeWidth={1.7}>
          <rect x={40.6} y={42.4} width={10.8} height={8} rx={1.6} />
          <path d="M41.2 43.4 l4.8 3.8 4.8 -3.8" />
        </g>
      );
    case "copy":
      return <path d="M44.2 40.8 h5.6 a1.4 1.4 0 0 1 1.4 1.4 v6.4 a1.4 1.4 0 0 1 -1.4 1.4 h-5.6 a1.4 1.4 0 0 1 -1.4 -1.4 v-6.4 a1.4 1.4 0 0 1 1.4 -1.4 z M40.8 43.8 v6.6 a1.6 1.6 0 0 0 1.6 1.6 h5.4" {...s} strokeWidth={1.7} />;
  }
}

/** The sheet of paper (with a folded corner). `offset` draws a second sheet behind it. */
function Sheet({ x = 0, y = 0, rotate = 0, faded = false }: { x?: number; y?: number; rotate?: number; faded?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate} 30 33)`} opacity={faded ? 0.55 : 1}>
      <path d="M18 12 h17 l9 9 v29 a3 3 0 0 1 -3 3 h-23 a3 3 0 0 1 -3 -3 v-35 a3 3 0 0 1 3 -3 z" fill="#ffffff" />
      <path d="M35 12 v6 a3 3 0 0 0 3 3 h6 z" fill="#dbe3f1" />
    </g>
  );
}

export function ToolIcon({ slug, size = 56, className }: { slug: string; size?: number; className?: string }) {
  const spec = SPECS[slug] ?? FALLBACK;
  const [light, deep] = PALETTE[spec.family];
  const id = `ti-${slug}`;
  const behind = spec.paper.kind === "double" || spec.paper.kind === "stack";
  const tilted = spec.paper.kind === "tilted";
  return (
    <svg className={`tool-icon ${className ?? ""}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`${id}-bg`} x1="8" y1="4" x2="58" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={deep} />
        </linearGradient>
        <radialGradient id={`${id}-shine`} cx="18" cy="10" r="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-shadow`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.6" stdDeviation="1.6" floodColor="#0b1020" floodOpacity="0.28" />
        </filter>
      </defs>
      {/* Tile with a soft top-left shine and a darker rim at the bottom for depth. */}
      <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#${id}-bg)`} />
      <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#${id}-shine)`} />
      <rect x="2.5" y="2.5" width="59" height="59" rx="16.5" fill="none" stroke="#fff" strokeOpacity="0.22" />
      {/* Paper */}
      <g className="tool-icon-paper" filter={`url(#${id}-shadow)`}>
        {behind && <Sheet x={-4} y={-3} faded />}
        {spec.paper.kind === "stack" && <Sheet x={-8} y={-6} faded />}
        <Sheet rotate={tilted ? -12 : 0} />
        <g transform={tilted ? "rotate(-12 30 33)" : undefined}>
          <PaperContent paper={spec.paper} deep={deep} />
        </g>
      </g>
      {/* Badge: the result, or the tool's action. */}
      <g className="tool-icon-badge" filter={`url(#${id}-shadow)`}>
        {"text" in spec.badge ? (
          <>
            <circle cx="46" cy="46" r="11.5" fill="#fff" />
            <circle cx="46" cy="46" r="9.6" fill={FORMAT[spec.badge.text] ?? deep} />
            <text x="46" y="48.4" textAnchor="middle" fontFamily={FONT} fontWeight={800} fontSize={spec.badge.text.length > 2 ? 6.2 : 7.5} fill="#fff" letterSpacing={0.1}>
              {spec.badge.text}
            </text>
          </>
        ) : (
          <>
            <circle cx="46" cy="46" r="11.5" fill="#fff" />
            <GlyphPath g={spec.badge.glyph} color={deep} />
          </>
        )}
      </g>
    </svg>
  );
}
