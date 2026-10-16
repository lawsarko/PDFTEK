"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { LOCALES, LOCALE_COOKIE, DEFAULT_LOCALE, isSitePath, localeInfo, localizePath, stripLocale } from "@/lib/i18n/locales";
import { compile, fill, norm, type Dict } from "@/lib/i18n/match";
import { I } from "./icons";

/**
 * Client side of translation.
 *  - I18nProvider / useT: website components rendered on the server use the translations the
 *    server hands down, so the page arrives already in the visitor's language.
 *  - DomTranslator: the app (workbench, editor, form filler…) is translated in the browser from
 *    the language's dictionary, replacing known English text as it appears.
 *  - LanguageSwitcher: the language menu.
 */

type Ctx = { locale: string; dict: Record<string, string> };
const I18nContext = createContext<Ctx>({ locale: DEFAULT_LOCALE, dict: {} });

export function I18nProvider({ locale, dict, children }: { locale: string; dict: Record<string, string>; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, dict }), [locale, dict]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useLocale() {
  return useContext(I18nContext).locale;
}

/** t("English text", { vars }) → the text in the visitor's language. */
export function useT() {
  const { dict } = useContext(I18nContext);
  return useMemo(() => (s: string, vars?: Record<string, string | number>) => fill(dict[norm(s)] ?? s, vars), [dict]);
}

/** Link to a website page in the visitor's language. */
export function useLocalePath() {
  const locale = useLocale();
  return (path: string) => localizePath(path, locale);
}

// ---------- in-browser translation of the app ----------

const SKIP = "script,style,textarea,code,pre,noscript,[data-no-translate],[contenteditable=true],.pdf-page,.textLayer,.edit-layer,.ff-layer,.page-scroll .pdf-page";
const ATTRS = ["placeholder", "title", "aria-label", "alt"] as const;

export function DomTranslator({ locale }: { locale: string }) {
  useEffect(() => {
    if (locale === DEFAULT_LOCALE) return;
    let lookup: ((s: string) => string | null) | null = null;
    const done = new WeakMap<Node, string>();
    const doneAttr = new WeakMap<Element, Record<string, string>>();
    const key = `pdftek-i18n:${locale}`;

    const textNode = (node: Text) => {
      const v = node.nodeValue ?? "";
      if (!lookup || !v.trim() || done.get(node) === v) return;
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIP)) return;
      const tr = lookup(v);
      if (tr === null) return;
      const next = (v.match(/^\s*/)?.[0] ?? "") + tr + (v.match(/\s*$/)?.[0] ?? "");
      done.set(node, next);
      if (next !== v) node.nodeValue = next;
    };
    const attrs = (el: Element) => {
      if (!lookup) return;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        const seen = doneAttr.get(el) ?? {};
        if (seen[a] === v) continue;
        const tr = lookup(v);
        if (tr === null) continue;
        seen[a] = tr;
        doneAttr.set(el, seen);
        if (tr !== v) el.setAttribute(a, tr);
      }
    };
    const walk = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) return textNode(root as Text);
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      const el = root as Element;
      if (el.closest(SKIP)) return;
      attrs(el);
      const it = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let n = it.nextNode(); n; n = it.nextNode()) {
        if (n.nodeType === Node.TEXT_NODE) textNode(n as Text);
        else attrs(n as Element);
      }
    };
    // Setting the title fires the title observer even when the text is the same, so only write a
    // title that actually changes, and never translate a title we wrote ourselves. (Without this, a
    // translation identical to its English — "PDF", brand names — looped forever and froze the page.)
    let ownTitle = "";
    const title = () => {
      const cur = document.title;
      if (!lookup || cur === ownTitle) return;
      const tr = lookup(cur.replace(/ \| PDFTEK$/, ""));
      if (!tr) return;
      const next = cur.endsWith(" | PDFTEK") ? `${tr} | PDFTEK` : tr;
      ownTitle = next;
      if (next !== cur) document.title = next;
    };
    const all = () => {
      walk(document.body);
      title();
    };
    const use = (d: Dict) => {
      try {
        lookup = compile(d);
        all();
      } catch (e) {
        console.warn("[pdftek] translation skipped", e);
      }
    };

    let cachedV = "";
    try {
      const cached = JSON.parse(localStorage.getItem(key) ?? "null") as (Dict & { v: string }) | null;
      if (cached?.exact) {
        cachedV = cached.v;
        use(cached);
      }
    } catch {}
    let cancelled = false;
    fetch(`/api/i18n/${locale}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: (Dict & { v: string }) | null) => {
        if (cancelled || !d || d.v === cachedV) return;
        try {
          localStorage.setItem(key, JSON.stringify(d));
        } catch {}
        use(d);
      })
      .catch(() => {});

    // Text the app renders later (dialogs, toasts, new rows) is translated as it appears.
    const obs = new MutationObserver((list) => {
      try {
        for (const m of list) {
          if (m.type === "characterData") textNode(m.target as Text);
          else if (m.type === "attributes") attrs(m.target as Element);
          else m.addedNodes.forEach(walk);
        }
      } catch {}
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    const head = document.querySelector("title");
    const titleObs = new MutationObserver(title);
    if (head) titleObs.observe(head, { childList: true, characterData: true, subtree: true });
    return () => {
      cancelled = true;
      obs.disconnect();
      titleObs.disconnect();
    };
  }, [locale]);
  return null;
}

// ---------- language menu ----------

/** Saves the choice and opens the same page in that language. */
export function switchLanguage(code: string) {
  document.cookie = `${LOCALE_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
  const path = stripLocale(window.location.pathname);
  if (isSitePath(path)) window.location.href = localizePath(path, code) + window.location.search + window.location.hash;
  else window.location.reload();
}

export function LanguageSwitcher({ variant = "nav" }: { variant?: "nav" | "footer" | "app" }) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const current = localeInfo(locale);
  return (
    <div className={`lang lang-${variant}`} ref={ref} data-no-translate>
      <button className="lang-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={`Language: ${current.name}`}>
        <I.globe size={variant === "footer" ? 14 : 16} />
        <span className="lang-name">{current.name}</span>
        <I.chevron size={11} />
      </button>
      {open && (
        <div className="lang-pop" role="listbox" aria-label="Language">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              role="option"
              aria-selected={l.code === locale}
              lang={l.tag}
              dir={l.rtl ? "rtl" : undefined}
              className={l.code === locale ? "on" : ""}
              onClick={() => {
                setOpen(false);
                if (l.code !== locale) switchLanguage(l.code);
              }}
            >
              <span className="lang-check">{l.code === locale ? <I.check size={13} /> : null}</span>
              {l.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
