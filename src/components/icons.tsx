type P = { size?: number; className?: string };

function svg(path: React.ReactNode) {
  return function Icon({ size = 16, className }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        {path}
      </svg>
    );
  };
}

export const I = {
  search: svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  upload: svg(<><path d="M12 16V4" /><path d="m6 10 6-6 6 6" /><path d="M4 20h16" /></>),
  download: svg(<><path d="M12 4v12" /><path d="m6 10 6 6 6-6" /><path d="M4 20h16" /></>),
  plus: svg(<><path d="M12 5v14M5 12h14" /></>),
  x: svg(<><path d="M18 6 6 18M6 6l12 12" /></>),
  check: svg(<path d="m5 12 5 5 9-10" />),
  file: svg(<><path d="M14 3H6v18h12V7z" /><path d="M14 3v4h4" /></>),
  lock: svg(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>),
  unlock: svg(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></>),
  edit: svg(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13 7 4 4" /></>),
  sign: svg(<><path d="M3 17c3-6 5-9 7-9s-1 8 1 8 3-5 5-5 1 4 5 4" /><path d="M3 21h18" /></>),
  speaker: svg(<><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16 9a3.5 3.5 0 0 1 0 6M18.5 6.5a7 7 0 0 1 0 11" /></>),
  swap: svg(<><path d="M7 4 3 8l4 4" /><path d="M3 8h14" /><path d="m17 20 4-4-4-4" /><path d="M21 16H7" /></>),
  compare: svg(<><rect x="3" y="4" width="7" height="16" rx="1" /><rect x="14" y="4" width="7" height="16" rx="1" /></>),
  convert: svg(<><path d="M4 7h11l-3-3" /><path d="M20 17H9l3 3" /></>),
  sparkle: svg(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="m6 6 2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></>),
  bell: svg(<><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></>),
  gear: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
  tools: svg(<><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z" /></>),
  camera: svg(<><path d="M4 8h3l2-3h6l2 3h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></>),
  image: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>),
  trash: svg(<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>),
  more: svg(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>),
  chevron: svg(<path d="m6 9 6 6 6-6" />),
  left: svg(<path d="m15 18-6-6 6-6" />),
  right: svg(<path d="m9 18 6-6-6-6" />),
  play: svg(<path d="M7 4v16l13-8z" />),
  pause: svg(<><path d="M8 5v14M16 5v14" /></>),
  zoomIn: svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M8 11h6M11 8v6" /></>),
  zoomOut: svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M8 11h6" /></>),
  history: svg(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>),
  tag: svg(<><path d="M3 12V3h9l9 9-9 9z" /><circle cx="7.5" cy="7.5" r="1.5" /></>),
  users: svg(<><circle cx="9" cy="8" r="3.5" /><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M22 20c0-3-2-5-5-5.8" /></>),
  inbox: svg(<><path d="M3 13h5l1 3h6l1-3h5" /><path d="M5 5h14l2 8v6H3v-6z" /></>),
  bolt: svg(<path d="M13 2 4 14h7l-1 8 9-12h-7z" />),
  chat: svg(<path d="M4 5h16v11H9l-5 4z" />),
  table: svg(<><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 10h18M3 15h18M9 4v16" /></>),
  merge: svg(<><path d="M6 3v6a6 6 0 0 0 6 6h6" /><path d="M6 21v-6" /><path d="m15 12 3 3-3 3" /></>),
  split: svg(<><path d="M12 3v6M12 9 6 15v6M12 9l6 6v6" /></>),
  rotate: svg(<><path d="M20 11A8 8 0 1 0 17.7 17" /><path d="M20 4v7h-7" /></>),
  layers: svg(<><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>),
  hash: svg(<><path d="M5 9h15M4 15h15M10 3 8 21M16 3l-2 18" /></>),
  drop: svg(<path d="M12 3s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12z" />),
  scan: svg(<><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><path d="M4 12h16" /></>),
  text: svg(<><path d="M5 5h14M12 5v14M9 19h6" /></>),
  highlight: svg(<><path d="m9 11-6 6v3h9l3-3" /><path d="m22 12-4.5 4.5L8 7l4.5-4.5z" /></>),
  eraser: svg(<><path d="M20 20H9l-6-6 10-10 8 8-7 7" /></>),
  redact: svg(<><rect x="3" y="8" width="18" height="8" fill="currentColor" /></>),
  undo: svg(<><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>),
  redo: svg(<><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></>),
  mail: svg(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>),
  link: svg(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>),
  copy: svg(<><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>),
  logout: svg(<><path d="M9 21H4V3h5" /><path d="m16 17 5-5-5-5M21 12H9" /></>),
  shield: svg(<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />),
  globe: svg(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>),
  folder: svg(<path d="M3 6h6l2 2h10v11H3z" />),
  clock: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  menu: svg(<path d="M4 6h16M4 12h16M4 18h16" />),
};

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="logo">
      <path d="M8 4h11l6 6v18H8z" fill="#f3f0e8" />
      <path className="logo-fold" d="M19 4v6h6" fill="#cfc9b8" />
      <rect className="logo-l1" x="11" y="14" width="10" height="2.2" rx="1" fill="#d98e2b" />
      <rect className="logo-l2" x="11" y="18.5" width="7" height="2.2" rx="1" fill="#7d8aa0" />
      <rect className="logo-l3" x="11" y="23" width="8.5" height="2.2" rx="1" fill="#7d8aa0" />
    </svg>
  );
}

/** "PDFTEK" wordmark. Each letter is its own span so the brand link can ripple them on hover. */
export function Wordmark() {
  return (
    <span className="wordmark" aria-label="PDFTEK">
      {[..."PDF"].map((c, i) => (
        <span key={i} aria-hidden style={{ "--i": i } as React.CSSProperties}>
          {c}
        </span>
      ))}
      {[..."TEK"].map((c, i) => (
        <span key={i + 3} aria-hidden className="wm-accent" style={{ "--i": i + 3 } as React.CSSProperties}>
          {c}
        </span>
      ))}
    </span>
  );
}
