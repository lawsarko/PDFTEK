/**
 * Tool pages (by their /go/<key>) that show the upload area instead of a "Start" button. Pages that
 * don't begin with a file (document requests, email in) keep the button. The upload behaviour for
 * each key lives in components/tool-start.tsx.
 */
export const TOOL_START_KEYS = [
  "pdf-to-word",
  "pdf-to-excel",
  "pdf-to-powerpoint",
  "pdf-to-jpg",
  "word-to-pdf",
  "excel-to-pdf",
  "powerpoint-to-pdf",
  "to-pdf",
  "jpg-to-pdf",
  "scan-to-pdf",
  "bank-statement-to-excel",
  "invoice-to-excel",
  "bulk-convert",
  "merge",
  "split",
  "organize",
  "rotate",
  "page-numbers",
  "compress",
  "protect",
  "unlock",
  "watermark",
  "fill-form",
  "edit",
  "sign",
  "ocr",
  "read-aloud",
  "ask",
  "translate",
  "compare",
  "esign-templates",
  "signing-links",
  "cloud",
] as const;

export const hasToolStart = (go: string) => (TOOL_START_KEYS as readonly string[]).includes(go);
