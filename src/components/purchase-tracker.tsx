"use client";
import { useEffect } from "react";
import { PRODUCTS, type ProductId } from "@/lib/plans";

type Gtag = (...args: unknown[]) => void;

/**
 * Reports a completed purchase to Google Analytics (as "purchase") and, when a conversion label
 * is set, to Google Ads (as a conversion). Checkout returns with ?purchased=<product>; each
 * purchase is reported once even if the page is reloaded.
 */
export function PurchaseTracker({ adsConversion }: { adsConversion: string }) {
  useEffect(() => {
    const product = new URLSearchParams(window.location.search).get("purchased") as ProductId | null;
    const p = product ? PRODUCTS[product] : undefined;
    if (!product || !p) return;
    const key = `pdftek-purchase-reported:${product}:${window.location.pathname}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {}
    const send = () => {
      const gtag = (window as unknown as { gtag?: Gtag }).gtag;
      if (!gtag) return false;
      const value = p.cents / 100;
      gtag("event", "purchase", { currency: "USD", value, items: [{ item_id: product, item_name: p.name, price: value, quantity: 1 }] });
      if (adsConversion) gtag("event", "conversion", { send_to: adsConversion, value, currency: "USD" });
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
