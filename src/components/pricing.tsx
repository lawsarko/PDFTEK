"use client";
import { useState } from "react";
import { PRODUCTS, FREE_LIMITS, type ProductId, usd } from "@/lib/plans";
import { startCheckout } from "./paywall";
import { I } from "./icons";
import { useToast } from "./toast";
import { useT } from "./i18n";

function useBuy(workspaceId?: string) {
  const toast = useToast();
  const [busy, setBusy] = useState<ProductId | null>(null);
  const buy = async (p: ProductId) => {
    setBusy(p);
    try {
      await startCheckout(p, workspaceId);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Checkout failed.", "error");
      setBusy(null);
    }
  };
  return { busy, buy };
}

type Card = {
  key: string;
  name: string;
  price: string;
  per?: string;
  note: string;
  features: string[];
  cta: string;
  product?: ProductId;
  href?: string;
  featured?: boolean;
};

/** The four plan cards. `current` hides the buy button for the plan already active. */
export function PlanCards({ workspaceId, current, yearly: initialYearly = false }: { workspaceId?: string; current?: string; yearly?: boolean }) {
  const { busy, buy } = useBuy(workspaceId);
  const t = useT();
  const [yearly, setYearly] = useState(initialYearly);
  const pro = yearly ? PRODUCTS.pro_year : PRODUCTS.pro_month;
  const cards: Card[] = [
    {
      key: "free",
      name: t("Free"),
      price: "$0",
      note: t("No account needed"),
      features: [
        t("{a} tasks a day without an account, {b} with a free account", { a: FREE_LIMITS.guest.tasksPerDay, b: FREE_LIMITS.free.tasksPerDay }),
        t("Convert to and from Word, Excel, PowerPoint, JPG"),
        t("Merge, split, compress, rotate, watermark, protect"),
        t("Files up to {mb} MB, {n} at a time", { mb: FREE_LIMITS.free.maxFileMb, n: FREE_LIMITS.free.maxFiles }),
        t("View and search your PDFs"),
      ],
      cta: t("Start now"),
      href: "/go/start",
    },
    {
      key: "pass",
      name: t("Day Pass"),
      price: usd(PRODUCTS.pass.cents),
      per: t("one time"),
      note: t("24 hours · no subscription"),
      features: [t("Everything in Pro for 24 hours"), t("Unlimited tasks, files up to 100 MB"), t("Edit PDFs, read aloud, e-signatures"), t("50 AI credits included")],
      cta: t("Get a Day Pass"),
      product: "pass",
    },
    {
      key: "pro",
      name: t("Pro"),
      price: yearly ? usd(Math.round(PRODUCTS.pro_year.cents / 12)) : usd(PRODUCTS.pro_month.cents),
      per: t("/month"),
      note: yearly ? t("{price} billed yearly", { price: usd(PRODUCTS.pro_year.cents) }) : t("Billed monthly · cancel anytime"),
      features: [
        t("Unlimited tasks, files up to 100 MB"),
        t("Edit text, images and true redaction"),
        t("Read aloud in 11 languages"),
        t("E-signatures with audit certificates"),
        t("400 AI credits every month"),
      ],
      cta: t("Go Pro"),
      product: pro === PRODUCTS.pro_year ? "pro_year" : "pro_month",
      featured: true,
    },
    {
      key: "team",
      name: t("Team"),
      price: usd(PRODUCTS.team_month.cents),
      per: t("/month"),
      note: t("Up to 5 people"),
      features: [t("Everything in Pro, for your whole team"), t("Automations and document requests"), t("Shared library, roles, hand-offs"), t("1,500 AI credits every month")],
      cta: t("Start Team"),
      product: "team_month",
    },
  ];
  return (
    <div>
      <div className="billing-toggle" role="tablist" aria-label={t("Billing period")}>
        <button role="tab" aria-selected={!yearly} className={!yearly ? "on" : ""} onClick={() => setYearly(false)}>
          {t("Monthly")}
        </button>
        <button role="tab" aria-selected={yearly} className={yearly ? "on" : ""} onClick={() => setYearly(true)}>
          {t("Yearly")} <span className="badge badge-good">{t("4 months free")}</span>
        </button>
      </div>
      <div className="price-grid price-grid-4">
        {cards.map((c) => {
          const isCurrent = current === c.key;
          return (
            <div key={c.key} className={`price ${c.featured ? "featured" : ""}`}>
              <div className="row between">
                <div className="eyebrow" style={c.featured ? { color: "var(--amber)" } : undefined}>{c.name}</div>
                {c.featured && <span className="badge badge-warn">{t("Most popular")}</span>}
              </div>
              <div className="amount">
                {c.price}
                {c.per && <span className="small muted" style={{ fontSize: 14, fontWeight: 400 }}> {c.per}</span>}
              </div>
              <div className="small muted">{c.note}</div>
              <ul>
                {c.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {isCurrent ? (
                <span className="btn btn-lg" style={{ marginTop: "auto", pointerEvents: "none", opacity: 0.7 }}>
                  <I.check size={14} /> {t("Your plan")}
                </span>
              ) : c.href ? (
                <a href={c.href} className="btn btn-lg" style={{ marginTop: "auto" }}>
                  {c.cta}
                </a>
              ) : (
                <button className={`btn btn-lg ${c.featured ? "btn-primary" : ""}`} style={{ marginTop: "auto" }} disabled={!!busy} onClick={() => buy(c.product!)}>
                  {busy === c.product && <span className="spinner" />} {c.cta}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Pay-as-you-go credit packs (AI and extra tasks). */
export function CreditPacks({ workspaceId }: { workspaceId?: string }) {
  const { busy, buy } = useBuy(workspaceId);
  const t = useT();
  const packs: { id: ProductId; tag?: string }[] = [{ id: "credits_250" }, { id: "credits_900", tag: t("Save {p}%", { p: 17 }) }, { id: "credits_3000", tag: t("Save {p}%", { p: 30 }) }];
  return (
    <div className="credit-packs">
      {packs.map(({ id, tag }) => {
        const p = PRODUCTS[id];
        return (
          <button key={id} className="plan-option" disabled={!!busy} onClick={() => buy(id)}>
            <span className="grow" style={{ textAlign: "left" }}>
              <span className="row" style={{ gap: 8 }}>
                <b>{t("{n} credits", { n: p.credits!.toLocaleString() })}</b>
                {tag && <span className="badge badge-good">{tag}</span>}
              </span>
              <span className="tiny muted">{t("{price} per 100 · never expire", { price: usd(Math.round((p.cents / p.credits!) * 1000) / 10) })}</span>
            </span>
            <span className="plan-price">{busy === id ? <span className="spinner" /> : usd(p.cents)}</span>
          </button>
        );
      })}
    </div>
  );
}
