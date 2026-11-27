import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Font subsetting with HarfBuzz (the shaping engine used by Chrome, Android and LibreOffice).
 * pdf-lib's own subsetter drops glyphs from many modern fonts, so fonts are subset here to just
 * the characters a document uses (keeping their shaping rules, so Arabic and Indic scripts still
 * join correctly) and then embedded whole. A Japanese font goes from ~5.7 MB to a few KB.
 */

type HB = {
  memory: WebAssembly.Memory;
  malloc(n: number): number;
  free(p: number): void;
  hb_blob_create(data: number, length: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(b: number): void;
  hb_blob_get_data(b: number, length: number): number;
  hb_blob_get_length(b: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(f: number): void;
  hb_face_reference_blob(f: number): number;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_or_fail(face: number, input: number): number;
  hb_set_add(set: number, cp: number): void;
};

let hb: Promise<HB> | null = null;

function load(): Promise<HB> {
  hb ??= (async () => {
    const wasm = await fs.readFile(path.join(process.cwd(), "node_modules/harfbuzzjs/hb-subset.wasm"));
    const { instance } = await WebAssembly.instantiate(wasm);
    return instance.exports as unknown as HB;
  })();
  return hb;
}

/** Returns a TrueType font with only the glyphs needed for `codepoints`, or null if it can't. */
export async function subsetFont(font: Uint8Array, codepoints: Iterable<number>): Promise<Buffer | null> {
  let x: HB;
  try {
    x = await load();
  } catch (e) {
    console.error("[pdftek] font subsetter unavailable", e);
    return null;
  }
  const ptr = x.malloc(font.byteLength);
  new Uint8Array(x.memory.buffer).set(font, ptr); // view taken after malloc: memory may have grown
  const blob = x.hb_blob_create(ptr, font.byteLength, 2 /* writable */, 0, 0);
  const face = x.hb_face_create(blob, 0);
  x.hb_blob_destroy(blob);
  const input = x.hb_subset_input_create_or_fail();
  const set = x.hb_subset_input_unicode_set(input);
  for (const cp of codepoints) x.hb_set_add(set, cp);
  const sub = x.hb_subset_or_fail(face, input);
  x.hb_subset_input_destroy(input);
  let out: Buffer | null = null;
  if (sub) {
    const res = x.hb_face_reference_blob(sub);
    const off = x.hb_blob_get_data(res, 0);
    const len = x.hb_blob_get_length(res);
    if (len > 0) out = Buffer.from(new Uint8Array(x.memory.buffer, off, len)); // copied out of wasm memory
    x.hb_blob_destroy(res);
    x.hb_face_destroy(sub);
  }
  x.hb_face_destroy(face);
  x.free(ptr);
  return out;
}
