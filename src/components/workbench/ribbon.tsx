"use client";
import { I } from "../icons";

/**
 * Every workbench tool, grouped. The tools panel, the home screen, the top search and the phone's
 * Tools sheet all list these; a tool picked with no document open asks for the file first and
 * then runs on it.
 */

export type Act = {
  key: string;
  label: string;
  icon: React.ReactNode;
  hint: string;
  /** Needs a Day Pass / Pro / Team. */
  pro?: boolean;
  /** Uses AI credits. */
  ai?: boolean;
  /** Works without an open document (starts from an upload or the library). */
  noDoc?: boolean;
};

export const RIBBON: { key: string; label: string; acts: Act[] }[] = [
  {
    key: "convert",
    label: "Convert",
    acts: [
      { key: "convert-docx", label: "To Word", icon: <I.file size={18} />, hint: "Editable Word document (.docx)" },
      { key: "convert-xlsx", label: "To Excel", icon: <I.table size={18} />, hint: "Tables become spreadsheet cells (.xlsx)" },
      { key: "convert-pptx", label: "To PowerPoint", icon: <I.layers size={18} />, hint: "One slide per page (.pptx)" },
      { key: "convert-jpg", label: "To JPG", icon: <I.image size={18} />, hint: "Every page as a JPG image" },
      { key: "convert-png", label: "To PNG", icon: <I.image size={18} />, hint: "Every page as a PNG image" },
      { key: "convert-more", label: "More formats", icon: <I.more size={18} />, hint: "WEBP, TIFF, plain text, or just this page" },
      { key: "statement", label: "Statement → Excel", icon: <I.table size={18} />, hint: "Bank or card transactions, checked against balances", ai: true },
      { key: "invoice", label: "Invoice → Excel", icon: <I.file size={18} />, hint: "Vendor, line items, tax and totals", ai: true },
      { key: "topdf", label: "Files → PDF", icon: <I.upload size={18} />, hint: "Word, Excel, PowerPoint, text or TIFF to PDF", noDoc: true },
      { key: "images", label: "Images → PDF", icon: <I.image size={18} />, hint: "Combine photos into one PDF", noDoc: true },
      { key: "scan", label: "Scan", icon: <I.camera size={18} />, hint: "Use your camera, with auto-crop", noDoc: true },
      { key: "ocr", label: "OCR", icon: <I.scan size={18} />, hint: "Make a scan searchable and copyable" },
    ],
  },
  {
    key: "edit",
    label: "Edit",
    acts: [
      { key: "edit", label: "Edit PDF", icon: <I.edit size={18} />, hint: "Change text, move and add images", pro: true },
      { key: "edit-text", label: "Add text", icon: <I.text size={18} />, hint: "Type anywhere on the page", pro: true },
      { key: "edit-mark", label: "Highlight", icon: <I.highlight size={18} />, hint: "Highlight, underline or strike out", pro: true },
      { key: "edit-ink", label: "Draw", icon: <I.pencil size={18} />, hint: "Pen, marker and shapes", pro: true },
      { key: "redact", label: "Redact", icon: <I.redact size={18} />, hint: "Permanently remove sensitive content", pro: true },
      { key: "watermark", label: "Watermark", icon: <I.drop size={18} />, hint: "Stamp DRAFT, CONFIDENTIAL or any text" },
      { key: "page_numbers", label: "Page numbers", icon: <I.hash size={18} />, hint: "“Page 1 of 10” or Bates numbering" },
      { key: "metadata", label: "Properties", icon: <I.tag size={18} />, hint: "Title, author and subject" },
    ],
  },
  {
    key: "organize",
    label: "Organize",
    acts: [
      { key: "organize", label: "Organize pages", icon: <I.layers size={18} />, hint: "Reorder, rotate or delete pages visually" },
      { key: "merge", label: "Merge", icon: <I.merge size={18} />, hint: "Combine documents into one", noDoc: true },
      { key: "split", label: "Split", icon: <I.split size={18} />, hint: "Break into parts by page ranges" },
      { key: "extract", label: "Extract pages", icon: <I.copy size={18} />, hint: "Copy pages into a new document" },
      { key: "delete_pages", label: "Delete pages", icon: <I.trash size={18} />, hint: "Remove pages and save a new version" },
      { key: "rotate", label: "Rotate", icon: <I.rotate size={18} />, hint: "Turn pages 90° or 180°" },
      { key: "optimize", label: "Compress", icon: <I.zoomOut size={18} />, hint: "Make the file smaller" },
      { key: "compare", label: "Compare", icon: <I.compare size={18} />, hint: "Redline two documents or versions" },
    ],
  },
  {
    key: "sign",
    label: "Fill & sign",
    acts: [
      { key: "fill", label: "Fill form", icon: <I.form size={18} />, hint: "AI finds every field and fills it from your profile", ai: true },
      { key: "sign", label: "Request signatures", icon: <I.sign size={18} />, hint: "Send for e-signature with reminders", pro: true },
      { key: "save-template", label: "Save as template", icon: <I.copy size={18} />, hint: "Reuse this document's signer roles and fields", pro: true },
      { key: "sign-hub", label: "Templates & links", icon: <I.link size={18} />, hint: "Sign templates, bulk send, public signing links and payments", pro: true, noDoc: true },
      { key: "request", label: "Request documents", icon: <I.inbox size={18} />, hint: "Collect files with a secure link", pro: true, noDoc: true },
      { key: "handoff", label: "Hand off", icon: <I.swap size={18} />, hint: "Assign the document to a teammate" },
    ],
  },
  {
    key: "protect",
    label: "Protect",
    acts: [
      { key: "protect", label: "Add password", icon: <I.lock size={18} />, hint: "Encrypt with AES-256 and set permissions" },
      { key: "unlock", label: "Remove password", icon: <I.unlock size={18} />, hint: "Unlock a PDF you can open", noDoc: true },
      { key: "redact", label: "Redact", icon: <I.redact size={18} />, hint: "Permanently remove sensitive content", pro: true },
      { key: "versions", label: "Version history", icon: <I.history size={18} />, hint: "See and restore earlier versions" },
      { key: "checkout", label: "Check out", icon: <I.lock size={18} />, hint: "Lock editing while you work on it" },
    ],
  },
  {
    key: "ai",
    label: "AI tools",
    acts: [
      { key: "translate", label: "Translate", icon: <I.globe size={18} />, hint: "Translate the PDF into 35+ languages and keep its layout", ai: true },
      { key: "ask", label: "Ask a question", icon: <I.chat size={18} />, hint: "Answers cite the page they came from", ai: true },
      { key: "summarize", label: "Summarize", icon: <I.sparkle size={18} />, hint: "Key points in a few lines", ai: true },
      { key: "extract-data", label: "Extract data", icon: <I.table size={18} />, hint: "Pull tables and key terms into a sheet", ai: true },
      { key: "read", label: "Read PDF", icon: <I.speaker size={18} />, hint: "Listen in 11 languages", pro: true },
      { key: "fill", label: "Fill form", icon: <I.form size={18} />, hint: "AI fills forms from your profile", ai: true },
    ],
  },
];

const ALL: Act[] = RIBBON.flatMap((t) => t.acts).filter((a, i, list) => list.findIndex((b) => b.key === a.key) === i);
export const needsDoc = (key: string) => !ALL.find((a) => a.key === key)?.noDoc;
