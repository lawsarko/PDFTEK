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

/** Opens "save your purchase" (create an account) for guests who paid. */
export function openSaveAccount() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("pdftek:save-account"));
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
  const [save, setSave] = useState<{ email: string | null } | null>(null);

  // Guests who paid are asked to create an account right away, so the purchase isn't tied to one browser.
  const offerSave = useCallback(async (force = false) => {
    const w = window.location.pathname.match(/\/app\/(ws_[^/?#]+)/)?.[1];
    if (!w) return;
    const e = (await fetch(`/api/workspaces/${w}/usage`).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as Entitlements | null;
    if (e?.guest && (force || e.membership || e.credits > 0)) setSave({ email: e.purchaseEmail });
  }, []);

  useEffect(() => {
    const onSave = () => void offerSave(true);
    window.addEventListener("pdftek:save-account", onSave);
    return () => window.removeEventListener("pdftek:save-account", onSave);
  }, [offerSave]);

  useEffect(() => {
    const open = (e: Event) => {
      setReason((e as CustomEvent<Reason>).detail);
      setWid(window.location.pathname.match(/\/app\/(ws_[^/?#]+)/)?.[1]);
    };
    window.addEventListener("pdftek:paywall", open);
    const url = new URL(window.location.href);
    const bought = url.searchParams.get("purchased");
    const restored = url.searchParams.get("save");
    const verified = url.searchParams.get("verified");
    if (verified === "1") {
      toast("Email confirmed. Thanks!", "success");
      url.searchParams.delete("verified");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    if (bought || restored) {
      if (bought) toast(PURCHASED[bought] ?? "Thanks for your purchase!", "success");
      else toast("Welcome back! Your purchase is restored.", "success");
      url.searchParams.delete("purchased");
      url.searchParams.delete("save");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      notifyUsage();
      void offerSave(Boolean(restored));
    }
    return () => window.removeEventListener("pdftek:paywall", open);
  }, [toast, offerSave]);

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

  if (save) return <SaveAccountModal email={save.email} onClose={() => setSave(null)} />;
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

/** Turns a guest (who has paid) into a real account in one step; the purchase and files come along. */
function SaveAccountModal({ email: initialEmail, onClose }: { email: string | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(initialEmail ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() || email.split("@")[0], email, password }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok) {
      window.location.reload();
      return;
    }
    setBusy(false);
    setExists(res.status === 409);
    setError(data.error ?? "Couldn't create the account. Try again.");
  };

  return (
    <Modal title="Save your purchase to an account" onClose={onClose}>
      <form className="col gap-12" onSubmit={submit}>
        <p className="small muted" style={{ margin: 0 }}>
          Right now your plan and credits live in this browser only. Create a free account to keep them and use them on any device. Your files come along too.
        </p>
        <div className="field">
          <label htmlFor="sa-name">Your name</label>
          <input id="sa-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        <div className="field">
          <label htmlFor="sa-email">Email</label>
          <input id="sa-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="sa-pw">Choose a password</label>
          <input id="sa-pw" className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <span className="tiny faint">At least 8 characters.</span>
        </div>
        {error && (
          <div className="error-text">
            {error}
            {exists && (
              <>
                {" "}
                <a href="/login">Sign in</a> and your purchase will move into that account.
              </>
            )}
          </div>
        )}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Later
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner" />} Save my purchase
          </button>
        </div>
      </form>
    </Modal>
  );
}
