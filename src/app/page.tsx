import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { I, Logo } from "@/components/icons";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { JsonLd } from "@/components/json-ld";
import { SEO_TOOLS, siteUrl } from "@/lib/seo-tools";
import { PRODUCTS } from "@/lib/plans";
import { alternatesFor, getI18n } from "@/lib/i18n/server";
import { LOCALES } from "@/lib/i18n/locales";
import { ConvertDemo, CountUp, FlowSequence, LiveChat, Reveal, ScrollProgress, Spotlight, TiltOnScroll, Typewriter } from "@/components/motion";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { locale, lp } = await getI18n();
  return { alternates: alternatesFor("/", locale), openGraph: { url: lp("/") } };
}

const POPULAR = ["fill-pdf-form", "bank-statement-to-excel", "invoice-to-excel", "pdf-to-word", "merge-pdf", "compress-pdf", "word-to-pdf", "jpg-to-pdf", "pdf-to-jpg", "split-pdf", "edit-pdf", "sign-pdf", "protect-pdf", "chat-with-pdf"];

const HOME_FAQ: [string, string][] = [
          ["Does the AI make things up?", "pdftek answers only from your documents and cites the page for every claim. Click a citation and the passage is highlighted in the viewer, so you can check any answer in seconds."],
          ["Can it read scanned documents and other languages?", "Yes. The assistant reads scans directly, and in-browser OCR adds a searchable text layer in 13 languages. Search, read-aloud and conversions work across 40+ languages."],
          ["Are the e-signatures legally binding?", "pdftek captures consent, signer identity via unique email links, IP addresses and timestamps, and adds a certificate of completion to the signed PDF. That's the standard evidence under ESIGN and eIDAS for simple electronic signatures. Check your jurisdiction's requirements for regulated documents."],
          ["What happens when two people edit at once?", "They can't overwrite each other. Editing checks the document out to one person, and teammates see who holds the lock. You can hand it off or check it back in at any time, and admins can release a stale lock."],
          ["Can we host it ourselves?", "Yes. pdftek ships as a single Docker image with a built-in database and file storage. Bring your own Anthropic API key for the AI features and your own SMTP server for email."],
];

const TYPED = ["converted.", "edited.", "signed.", "understood.", "handled."];

const MARQUEE_A = [
  ["PDF", "Word"], ["Word", "PDF"], ["PDF", "Excel"], ["Excel", "PDF"], ["PowerPoint", "PDF"], ["PDF", "PowerPoint"],
  ["JPG", "PDF"], ["PDF", "PNG"], ["Scan", "searchable PDF"], ["HEIC", "PDF"], ["PDF", "TIFF"], ["Text", "PDF"],
];
const MARQUEE_B = [
  "✍️ E-signatures", "🔍 OCR in 13 languages", "🤖 AI answers with page citations", "✂️ Split & merge", "🖍️ Click-to-edit text",
  "⬛ True redaction", "🔔 Automations", "📥 Document requests", "🔊 Read aloud", "🧾 Extract to Excel", "🔒 Version history", "🧭 Compare & redline",
];

const FEATURES: { icon: React.ReactNode; title: string; body: string }[] = [
  { icon: <I.form size={18} />, title: "Forms that fill themselves", body: "Upload any form, even a scan. AI finds every field, explains each question, fills what it knows from your profile and documents, and you just check and sign." },
  { icon: <I.table size={18} />, title: "Bank statements & invoices to Excel", body: "Turn statements into clean transaction rows and invoices into line items, checked against the balances and totals. Convert a whole year of statements or a folder of invoices into one spreadsheet." },
  { icon: <I.sparkle size={18} />, title: "Answers with receipts", body: "Ask anything about a contract, filing or report. Every answer links to the exact page and passage, highlighted in the document." },
  { icon: <I.layers size={18} />, title: "A searchable knowledge base", body: "Every upload is indexed page by page. Search or chat across your entire library, in any language, including scans after OCR." },
  { icon: <I.table size={18} />, title: "Extraction you can trust", body: "Pull key terms, deadlines, obligations, parties, financials and tables into clean spreadsheets. Risk flags are checked against your own playbook." },
  { icon: <I.edit size={18} />, title: "Real PDF editing", body: "Click any line to change it. Add text and images, highlight, and redact for real. Redacted pages are flattened, so hidden text is gone." },
  { icon: <I.sign size={18} />, title: "E-signatures built in", body: "Place fields, route to signers in order, send reminders. Every signed PDF ships with a certificate of completion and a SHA-256 fingerprint." },
  { icon: <I.bolt size={18} />, title: "Automations", body: "Risk review on upload, weekday digests, renewal reminders 60 days out, and Slack or Teams webhooks. No-code, and it runs while you sleep." },
  { icon: <I.convert size={18} />, title: "Convert anything", body: "Word, Excel, PowerPoint, text and images (JPG, PNG, multi-page TIFF) to PDF, and PDF back to Word, Excel, PowerPoint, JPG, PNG, WEBP and TIFF, with the formatting intact. Camera scans to PDF. Merge, split, reorder, watermark." },
  { icon: <I.lock size={18} />, title: "Team-grade control", body: "Check-out locks prevent conflicting edits. Hand-offs keep ownership clear. Every version is kept, with a full activity trail." },
  { icon: <I.inbox size={18} />, title: "Document requests", body: "Collect NDAs, W-9s and certificates from clients through a secure upload link, with due dates and reminders. No account needed on their side." },
];

export default async function Home() {
  const user = await currentUser();
  const site = siteUrl();
  const { t, lp, info } = await getI18n();
  return (
    <div className="mk">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": `${site}/#org`,
              name: "PDFTEK",
              url: site,
              // Google needs a raster logo (at least 112 px) for search results and knowledge panels.
              logo: `${site}/icon-512.png`,
            },
            { "@type": "WebSite", "@id": `${site}/#site`, name: "PDFTEK", url: site, inLanguage: LOCALES.map((l) => l.tag), publisher: { "@id": `${site}/#org` } },
            {
              "@type": "FAQPage",
              inLanguage: info.tag,
              mainEntity: HOME_FAQ.map(([q, a]) => ({ "@type": "Question", name: t(q), acceptedAnswer: { "@type": "Answer", text: t(a) } })),
            },
            {
              "@type": "SoftwareApplication",
              name: "PDFTEK",
              url: site,
              applicationCategory: "BusinessApplication",
              operatingSystem: "Any (web browser)",
              description: t("Online PDF workbench: convert, merge, split, compress, protect, OCR, edit, e-sign and chat with PDFs. Most tools are free without an account."),
              featureList: SEO_TOOLS.map((tool) => t(tool.name)),
              offers: [
                { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD" },
                { "@type": "Offer", name: "Day Pass", price: (PRODUCTS.pass.cents / 100).toFixed(2), priceCurrency: "USD" },
                { "@type": "Offer", name: "Pro (monthly)", price: (PRODUCTS.pro_month.cents / 100).toFixed(2), priceCurrency: "USD" },
              ],
              publisher: { "@id": `${site}/#org` },
            },
          ],
        }}
      />
      <MarketingNav signedIn={!!user} />

      <ScrollProgress />
      <section className="mk-hero">
        <div className="hero-bg" aria-hidden>
          <span className="orb orb-a" />
          <span className="orb orb-b" />
          <span className="orb orb-c" />
        </div>
        <div className="mk-section" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <span className="hero-kicker">
            <span className="live" /> {t("Convert · Edit · Sign · Ask AI")}
          </span>
          <h1>
            {t("Every document,")}
            <br />
            <Typewriter className="tw-word" words={TYPED.map((w) => t(w))} />
          </h1>
          <p className="lead">{t("Convert, edit, sign and understand your PDFs in one place.")}</p>
          <div className="mk-cta">
            <Link prefetch={false} className="btn btn-primary btn-lg btn-glow" href={user ? "/app" : "/go/start"}>
              {user ? t("Open your workbench") : t("Start free — no sign-up needed")}
            </Link>
            <Link className="btn btn-lg" href={lp("/how-it-works")}>
              {t("See how it works")}
            </Link>
          </div>
          <TiltOnScroll>
            <div className="mk-shot" aria-hidden>
              <ProductShot t={t} />
            </div>
          </TiltOnScroll>
        </div>
      </section>

      <div className="marquee" aria-hidden style={{ marginTop: 40 }}>
        <div className="marquee-track">
          {[...MARQUEE_A, ...MARQUEE_A].map(([a, b], i) => (
            <span key={i} className="marquee-item">
              {t(a)} <b>→</b> {t(b)}
            </span>
          ))}
        </div>
      </div>
      <div className="marquee rev" aria-hidden style={{ borderTop: 0 }}>
        <div className="marquee-track">
          {[...MARQUEE_B, ...MARQUEE_B].map((m, i) => (
            <span key={i} className="marquee-item">
              {t(m)}
            </span>
          ))}
        </div>
      </div>

      <section className="mk-section" style={{ paddingTop: 48, paddingBottom: 48 }}>
        <div className="stat-row">
          <Reveal className="stat" delay={0}>
            <b><CountUp to={1} /> {t("page")}</b>
            <span>{t("Every AI answer points to its source page")}</span>
          </Reveal>
          <Reveal className="stat" delay={120}>
            <b><CountUp to={12} /> {t("formats")}</b>
            <span>{t("In and out: Office, images, scans and text")}</span>
          </Reveal>
          <Reveal className="stat" delay={240}>
            <b><CountUp to={40} suffix="+" /> {t("languages")}</b>
            <span>{t("Searched, read aloud and understood")}</span>
          </Reveal>
          <Reveal className="stat" delay={360}>
            <b>{t("0 re-keying")}</b>
            <span>{t("Extract straight into Excel and CSV")}</span>
          </Reveal>
        </div>
      </section>

      <section className="mk-section" id="convert">
        <div className="mk-split">
          <Reveal>
            <div className="eyebrow">{t("Convert")}</div>
            <h2 className="mk-h2" style={{ marginTop: 10 }}>
              {t("Any format in. Any format out.")}
            </h2>
            <p className="mk-sub">{t("Word, Excel and PowerPoint to PDF and back, with fonts, tables, bullets and spacing exactly where they were. Even scans and receipts come out editable.")}</p>
            <div className="mk-cta" style={{ justifyContent: "flex-start" }}>
              <Link prefetch={false} className="btn btn-primary" href={user ? "/app" : "/go/start"}>
                {t("Convert a file now")}
              </Link>
            </div>
          </Reveal>
          <Reveal delay={150} className="card" style={{ padding: 0 }}>
            <ConvertDemo />
          </Reveal>
        </div>
      </section>

      <section className="mk-section" id="tools" style={{ paddingTop: 24 }}>
        <Reveal>
          <div className="eyebrow">{t("PDF tools")}</div>
          <h2 className="mk-h2" style={{ marginTop: 10 }}>{t("Popular PDF tools, free online.")}</h2>
          <div className="seo-grid">
            {POPULAR.map((slug) => SEO_TOOLS.find((x) => x.slug === slug)!).map((tool) => (
              <Link key={tool.slug} href={lp(`/${tool.slug}`)} className="seo-tile">
                <b>{t(tool.name)}</b>
                <span>{t(`${tool.description.split(". ")[0]}.`)}</span>
              </Link>
            ))}
          </div>
          <p style={{ marginTop: 18 }}>
            <Link href={lp("/tools")}>{t("See all {n} PDF tools →", { n: SEO_TOOLS.length })}</Link>
          </p>
        </Reveal>
      </section>

      <section className="mk-section" id="features">
        <Reveal>
          <div className="eyebrow">{t("Features")}</div>
          <h2 className="mk-h2" style={{ marginTop: 10 }}>
            {t("Everything a document goes through, in one place.")}
          </h2>
          <p className="mk-sub">{t("Replace the converter tab, the e-sign subscription, the shared-drive scramble and the “which version is final?” email thread.")}</p>
        </Reveal>
        <Spotlight className="mk-grid">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} className="mk-card" delay={(i % 3) * 110}>
              <div className="mk-ico">{f.icon}</div>
              <h3>{t(f.title)}</h3>
              <p>{t(f.body)}</p>
            </Reveal>
          ))}
        </Spotlight>
      </section>

      <section className="mk-section" id="how">
        <div className="mk-split">
          <Reveal>
            <div className="eyebrow">{t("How teams use pdftek")}</div>
            <h2 className="mk-h2" style={{ marginTop: 10 }}>
              {t("From inbox to executed, without leaving the page.")}
            </h2>
            <ul className="mk-list">
              <li>{t("A vendor MSA lands. An automation extracts risk flags against your playbook and pings #legal.")}</li>
              <li>{t("Counsel asks “what's our exit path?” and gets the termination-for-convenience clause, with a link to page 2.")}</li>
              <li>{t("They check the document out, redline the notice period in place, and save v3. Nobody else can overwrite it.")}</li>
              <li>{t("They hand it to Contracts, who sends it for signature in order. Reminders go out automatically.")}</li>
              <li>{t("Once it's fully signed, key terms go to the tracker, and a renewal reminder is set for 60 days before expiry.")}</li>
            </ul>
          </Reveal>
          <Reveal delay={150} className="card" style={{ padding: 20 }}>
            <FlowSequence steps={[t("📥 New PDF in library"), t("🔍 Extract risk flags"), t("🔔 Notify team")]} note={t("Instant, on upload")} />
            <hr className="divider" />
            <FlowSequence steps={[t("✍️ Contract fully signed"), t("🔍 Extract key terms"), t("🔗 Webhook → tracker")]} note={t("Instant")} />
            <hr className="divider" />
            <FlowSequence steps={[t("📅 Renewal in 60 days"), t("✉️ Email reminder")]} note={t("Daily check, 9:00 AM")} />
          </Reveal>
        </div>
      </section>

      <section className="mk-section" id="security">
        <div className="mk-split">
          <Reveal className="card" style={{ padding: 24 }}>
            <div className="col gap-12">
              {[
                ["Workspace isolation", "Every request is authorized against workspace membership and role."],
                ["Immutable versions", "Each save is a new version with a SHA-256 fingerprint. Restore any version at any time."],
                ["True redaction", "Redacted pages are rasterized, so the underlying text is removed, not just covered."],
                ["Audit trails", "Activity logs, signer IP addresses and timestamps, and certificates of completion."],
                ["Private OCR", "Text recognition runs in your browser. Scans never go to a third-party OCR service."],
                ["Self-hostable", "Run pdftek on your own infrastructure, with your documents on your disks."],
              ].map(([h, b]) => (
                <div key={h} className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                  <span style={{ color: "var(--good)" }}>
                    <I.shield size={16} />
                  </span>
                  <div>
                    <b>{t(h)}</b>
                    <div className="small muted">{t(b)}</div>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={150}>
            <div className="eyebrow">{t("Security")}</div>
            <h2 className="mk-h2" style={{ marginTop: 10 }}>
              {t("Built for documents you can't afford to leak.")}
            </h2>
            <p className="mk-sub">
              {t("Contracts, financials and patient records need more than a free converter site. pdftek keeps your files in your workspace, logs who touched what, and can run entirely on your own servers.")}
            </p>
          </Reveal>
        </div>
      </section>

      <section className="mk-section faq" id="faq" style={{ maxWidth: 820 }}>
        <h2 className="mk-h2">{t("Questions, answered")}</h2>
        {HOME_FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{t(q)}</summary>
            <p>{t(a)}</p>
          </details>
        ))}
      </section>

      <Reveal as="section" className="mk-section" style={{ textAlign: "center", paddingTop: 40 }}>
        <Logo size={40} />
        <h2 className="mk-h2" style={{ marginTop: 16 }}>
          {t("Your documents, finally under control.")}
        </h2>
        <div className="mk-cta">
          <Link prefetch={false} className="btn btn-primary btn-lg" href={user ? "/app" : "/go/start"}>
            {user ? t("Open your workbench") : t("Create your free workspace")}
          </Link>
        </div>
      </Reveal>

      <MarketingFooter />
    </div>
  );
}

function ProductShot({ t }: { t: (s: string) => string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "210px 1fr 290px", minHeight: 420, fontSize: 12 }} className="shot-grid">
      <div style={{ borderRight: "1px solid var(--line)", padding: 12 }}>
        <div className="eyebrow">{t("Library")}</div>
        {["MSA — Northwind Supply.pdf", "DPA Amendment — Q3.pdf", "Vendor NDA — draft v4.pdf", "Board deck — FY25.pptx"].map((n, i) => (
          <div key={n} className={`doc-item ${i === 0 ? "active" : ""}`} style={{ marginTop: 6 }}>
            <div className="doc-icon">PDF</div>
            <div className="grow">
              <div className="doc-name ellipsis" style={{ fontSize: 12 }}>{n}</div>
              <div className="doc-sub">{[14, 6, 4, 22][i]} {t("pages")}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: "var(--ink)", padding: 22, display: "flex", justifyContent: "center" }}>
        <div style={{ background: "var(--paper)", color: "#2b2a26", width: "100%", maxWidth: 420, padding: "28px 30px", borderRadius: 2, boxShadow: "var(--shadow)" }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: ".1em", color: "#8a8471" }}>MASTER SERVICE AGREEMENT · PAGE 2 OF 14</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 17, margin: "12px 0" }}>3. Term &amp; Termination</div>
          <p style={{ lineHeight: 1.7, margin: "0 0 10px" }}>
            This Agreement shall commence on the Effective Date and continue for an initial term of twenty-four (24) months, automatically renewing unless either party provides notice at least sixty (60) days prior…
          </p>
          <p style={{ lineHeight: 1.7, margin: 0 }}>
            <span className="hl-sweep">Client may additionally terminate for convenience upon ninety (90) days&apos; written notice</span>, subject to the wind-down obligations set forth in Section 8.
          </p>
        </div>
      </div>
      <div style={{ borderLeft: "1px solid var(--line)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="row gap-4">
          <span className="chip active">{t("Chat")}</span>
          <span className="chip">{t("Extract")}</span>
          <span className="chip">{t("Automate")}</span>
        </div>
        <LiveChat />
        <div className="row gap-4 wrap" style={{ marginTop: "auto" }}>
          <span className="chip">{t("Compare to playbook")}</span>
          <span className="chip">{t("Summarize §9")}</span>
        </div>
      </div>
    </div>
  );
}
