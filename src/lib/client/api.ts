const PAYWALL_CODES = new Set(["limit_reached", "membership_required", "credits_required", "file_too_large", "batch_limit"]);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "content-type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const data = await res.json();
      msg = data.error ?? msg;
      code = data.code;
    } catch {}
    // Plan limits open the upgrade modal (mounted in the root layout) instead of a dead end.
    if (res.status === 402 && code && PAYWALL_CODES.has(code) && typeof window !== "undefined") {
      (window as unknown as { __pdftekPaywall?: string }).__pdftekPaywall = msg;
      window.dispatchEvent(new CustomEvent("pdftek:paywall", { detail: { code, message: msg } }));
    }
    if (res.status === 401 && typeof window !== "undefined" && !url.includes("/api/auth/")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    throw new ApiError(res.status, msg, code);
  }
  // Any successful action may have used a task or credits: let usage meters refresh.
  if ((rest.method ?? "GET") !== "GET" && typeof window !== "undefined") window.dispatchEvent(new Event("pdftek:usage"));
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? res.json() : res.blob()) as Promise<T>;
}

export function errMsg(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong.";
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function timeAgo(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: d > 300 ? "numeric" : undefined });
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
