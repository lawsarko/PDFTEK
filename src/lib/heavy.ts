import "server-only";

/**
 * Runs memory-hungry work (LibreOffice, Ghostscript, TIFF decoding) a few at a time. Each of these
 * can take 100–300 MB while it runs; several at once on a small server exceed its memory and the
 * whole site restarts. Extra jobs wait their turn instead. PDFTEK_HEAVY_CONCURRENCY raises the
 * limit on servers with more memory.
 */
const LIMIT = Math.max(1, Number(process.env.PDFTEK_HEAVY_CONCURRENCY) || 1);
let running = 0;
const waiting: (() => void)[] = [];

export async function heavy<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= LIMIT) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}
