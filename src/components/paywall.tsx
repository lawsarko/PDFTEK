"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PRODUCTS, EXTRA_TASK_CREDITS, FREE_LIMITS, type Entitlements, type ProductId, usd } from "@/lib/plans";
import { I } from "./icons";
import { Modal } from "./modal";
import { useToast } from "./toast";

/** Error codes from the API that mean "this needs a purchase". */
export const PAYWALL_CODES = new Set(["limit_reached", "membership_required", "credits_required", "file_too_large", "batch_limit"]);

type Reason = { code: string; message: string } | { code: "browse"; message?: string };

/** Opens the paywall from anywhere (the API client calls this on a 402). */
export function notifyPaywall(reason: Reason) {
  if (typeof window === "undefined") return;
  (window as unknown as { __pdftekPaywall?: string }).__pdftekPaywall = reason.message;
  window.dispatchEvent(new CustomEvent("pdftek:paywall", { detail: reason }));
}

/** Tells usage meters to refresh after a task ran or a purchase completed. */
export function notifyUsage() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("pdftek:usage"));
}

export async function startCheckout(product: ProductId, workspaceId?: string) {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ product, workspaceId, returnTo: window.location.pathname + window.location.search.replace(/[?&]purchased=[^&]*/, "") }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? "Checkout couldn't start. Try again.");
  window.location.href = data.url;
}

const PURCHASED: Record<string, string> = {
  pass: "Day Pass active: everything is unlocked for 24 hours.",
  pro_month: "Welcome to pdftek Pro!",
  pro_year: "Welcome to pdftek Pro!",
  team_month: "Welcome to pdftek Team!",
  credits_250: "250 credits added.",
  credits_900: "900 credits added.",
  credits_3000: "3,000 credits added.",
};

/** Mounted once in the root layout: shows the upgrade modal and confirms purchases. */
export function PaywallHost() {
  const toast = useToast();
  const [reason, setReason] = useState<Reason | null>(null);
  const [busy, setBusy] = useState<ProductId | null>(null);
  const [wid, setWid] = useState<string | undefined>();

  useEffect(() => {
    const open = (e: Event) => {
      setReason((e as CustomEvent<Reason>).detail);
      setWid(window.location.pathname.match(/\/app\/(ws_[^/?#]+)/)?.[1]);
    };
    window.addEventListener("pdftek:paywall", open);
    const url = new URL(window.location.href);
    const bought = url.searchParams.get("purchased");
    if (bought) {
      toast(PURCHASED[bought] ?? "Thanks for your purchase!", "success");
      url.searchParams.delete("purchased");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      notifyUsage();
    }
    return () => window.removeEventListener("pdftek:paywall", open);
  }, [toast]);

  const buy = useCallback(
    async (p: ProductId) => {
      setBusy(p);
      try {
        await startCheckout(p, wid);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Checkout failed.", "error");
        setBusy(null);
      }
    },
    [toast, wid],
  );

  if (!reason) return null;
  const code = reason.code;
  const ai = code === "credits_required";
  const title = ai
    ? "Get AI credits"
    : code === "limit_reached"
      ? "You've reached today's free limit"
      : code === "membership_required"
        ? "Unlock this with a Day Pass or Pro"
        : code === "browse"
          ? "pdftek plans"
          : "This file needs a Day Pass or Pro";

  const options: { id: ProductId; badge?: string; sub: string }[] = ai
    ? [
        { id: "credits_250", sub: "About 10–20 questions on a typical contract" },
        { id: "credits_900", badge: "Best value", sub: "Never expire" },
        { id: "pro_month", sub: "Includes 400 credits every month, plus every Pro tool" },
      ]
    : [
        { id: "pass", badge: "No subscription", sub: "Everything unlocked for 24 hours + 50 AI credits" },
        { id: "pro_month", badge: "Most popular", sub: "Unlimited tasks, edit, read aloud, e-sign + 400 AI credits/mo" },
        ...(code === "limit_reached" ? [{ id: "credits_250" as ProductId, sub: `Pay per task: ${EXTRA_TASK_CREDITS} credits each (≈125 tasks), never expire` }] : [{ id: "pro_year" as ProductId, sub: "Pro billed yearly: 4 months free" }]),
      ];

  return (
    <Modal title={title} onClose={() => { setReason(null); setBusy(null); }}>
      <div className="col gap-12">
        {reason.message && <p className="muted" style={{ margin: 0 }}>{reason.message}</p>}
        <div className="col gap-8">
          {options.map((o) => {
            const p = PRODUCTS[o.id];
            return (
              <button key={o.id} className={`plan-option ${o.badge === "Most popular" || (ai && o.badge) ? "featured" : ""}`} onClick={() => buy(o.id)} disabled={!!busy}>
                <span className="grow" style={{ textAlign: "left" }}>
                  <span className="row" style={{ gap: 8 }}>
                    <b>{p.name.replace("pdftek ", "")}</b>
                    {o.badge && <span className="badge badge-warn">{o.badge}</span>}
                  </span>
                  <span className="tiny muted">{o.sub}</span>
                </span>
                <span className="plan-price">
                  {busy === o.id ? <span className="spinner" /> : usd(p.cents)}
                  {p.interval && <span className="tiny muted">/{p.interval === "month" ? "mo" : "yr"}</span>}
                </span>
              </button>
            );
          })}
        </div>
        <div className="row between tiny muted wrap" style={{ gap: 8 }}>
          <span>
            <I.lock size={11} /> Secure checkout by Stripe · no account needed · cancel anytime
          </span>
          <Link href="/pricing" onClick={() => setReason(null)}>Compare all plans →</Link>
        </div>
        {code === "limit_reached" && (
          <p className="tiny faint" style={{ margin: 0 }}>
            Free limits reset every day at midnight UTC ({FREE_LIMITS.guest.tasksPerDay} tasks without an account, {FREE_LIMITS.free.tasksPerDay} with a free account).
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Compact plan / usage / credits indicator for the app header. */
export function UsageMeter({ wid }: { wid: string }) {
  const [e, setE] = useState<Entitlements | null>(null);
  const load = useCallback(() => {
    fetch(`/api/workspaces/${wid}/usage`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setE)
      .catch(() => {});
  }, [wid]);
  useEffect(() => {
    load();
    window.addEventListener("pdftek:usage", load);
    const t = setInterval(load, 60_000);
    return () => {
      window.removeEventListener("pdftek:usage", load);
      clearInterval(t);
    };
  }, [load]);
  if (!e) return null;
  const credits = e.credits + e.allowance;
  const hours = e.passUntil ? Math.max(1, Math.round((e.passUntil - Date.now()) / 3_600_000)) : 0;
  const label =
    e.tier === "admin"
      ? "Admin"
      : e.tier === "team"
        ? "Team"
        : e.tier === "pro"
          ? "Pro"
          : e.tier === "pass"
            ? `Day Pass · ${hours}h left`
            : `${Math.max(0, (e.taskLimit ?? 0) - e.tasksToday)} of ${e.taskLimit} free tasks left`;
  const low = !e.membership && e.taskLimit !== null && e.tasksToday >= e.taskLimit * 0.7;
  return (
    <button
      className={`usage-meter ${e.membership ? "paid" : ""} ${low ? "low" : ""}`}
      onClick={() => notifyPaywall({ code: "browse", message: e.membership ? undefined : "Free tools stay free. Upgrade only when you need more." })}
      title="Plan and credits"
    >
      <span>{label}</span>
      {(credits > 0 || e.tier !== "guest") && (
        <span className="usage-credits">
          <I.sparkle size={11} /> {credits.toLocaleString()}
        </span>
      )}
      {!e.membership && <span className="usage-upgrade">Upgrade</span>}
    </button>
  );
}
