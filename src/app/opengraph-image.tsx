import { OG_SIZE, ogImage } from "@/lib/og";

export const alt = "PDFTEK – free online PDF tools";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogImage("Every document, handled.", "Convert, merge, compress, edit, sign and chat with PDFs.");
}
