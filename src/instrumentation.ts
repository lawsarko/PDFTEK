export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startMemoryMonitor } = await import("./lib/memory-monitor");
    startMemoryMonitor();
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.PDFTEK_DISABLE_SCHEDULER !== "1") {
    const { startScheduler } = await import("./lib/automations");
    startScheduler();
  }
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTranslator } = await import("./lib/i18n/worker");
    startTranslator();
  }
}
