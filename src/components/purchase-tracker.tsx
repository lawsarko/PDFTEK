"use client";
import { useEffect } from "react";
import { PRODUCTS, type ProductId } from "@/lib/plans";

type Gtag = (...args: unknown[]) => void;

/**
 * Reports a completed purchase to Google Analytics (as "purchase") and to Google Ads (as the
 * Purchase conversion). Checkout returns with ?purchased=<product>&order=…&paid=<cents>&new=1|0;
 * each order is reported once even if the page is reloaded, and Google also de-duplicates by
 * transaction_id.
 */
export function PurchaseTracker({ adsConversion }: { adsConversion: string }) {
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const product = q.get("purchased") as ProductId | null;
    const p = product ? PRODUCTS[product] : undefined;
    if (!product || !p) return;
    const order = q.get("order") ?? "";
    const paid = Number(q.get("paid"));
    const isNew = q.get("new");
    const key = `pdftek-purchase-reported:${order || `${product}:${window.location.pathname}`}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {}
    const send = () => {
      const gtag = (window as unknown as { gtag?: Gtag }).gtag;
      if (!gtag) return false;
      // The amount actually charged (after any discount), else the list price.
      const value = Number.isFinite(paid) && q.has("paid") ? paid / 100 : p.cents / 100;
      const ids = order ? { transaction_id: order } : {};
      const fresh = isNew === null ? {} : { new_customer: isNew === "1" };
      gtag("event", "purchase", { currency: "USD", value, ...ids, items: [{ item_id: product, item_name: p.name, price: value, quantity: 1 }] });
      if (adsConversion) gtag("event", "conversion", { send_to: adsConversion, value, currency: "USD", ...ids, ...fresh });
      return true;
    };
    // The tag loads after the page; try again briefly if it isn't ready yet.
    if (send()) return;
    let tries = 0;
    const t = setInterval(() => {
      if (send() || ++tries > 20) clearInterval(t);
    }, 500);
    return () => clearInterval(t);
  }, [adsConversion]);
  return null;
}
