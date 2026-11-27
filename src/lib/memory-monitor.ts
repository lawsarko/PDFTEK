import fs from "node:fs";
import v8 from "node:v8";

/**
 * Logs memory use every 15 minutes (and a warning when close to the instance's limit), so a
 * restart for "exceeded its memory limit" can be traced in the logs: steady growth points to a
 * leak, a sudden jump to one heavy file.
 */
function instanceLimitMb(): number | null {
  for (const f of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const n = Number(fs.readFileSync(f, "utf8").trim());
      if (n > 0 && n < 2 ** 50) return Math.round(n / 1048576);
    } catch {}
  }
  return null;
}

export function startMemoryMonitor() {
  const g = globalThis as typeof globalThis & { __pdftekMemory?: NodeJS.Timeout };
  if (g.__pdftekMemory) return;
  const limit = instanceLimitMb();
  const heapLimit = Math.round(v8.getHeapStatistics().heap_size_limit / 1048576);
  console.info(`[pdftek] memory: instance limit ${limit ? `${limit} MB` : "unknown"}, Node heap limit ${heapLimit} MB`);
  const report = () => {
    const m = process.memoryUsage();
    const mb = (n: number) => Math.round(n / 1048576);
    const near = limit && mb(m.rss) > limit * 0.8;
    (near ? console.warn : console.info)(
      `[pdftek] memory${near ? " HIGH" : ""}: rss ${mb(m.rss)} MB${limit ? ` of ${limit}` : ""}, heap ${mb(m.heapUsed)}/${mb(m.heapTotal)} MB, buffers ${mb(m.arrayBuffers)} MB, external ${mb(m.external)} MB`,
    );
  };
  g.__pdftekMemory = setInterval(report, 15 * 60_000);
  g.__pdftekMemory.unref();
}
