import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { I, Logo } from "@/components/icons";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { ConvertDemo, CountUp, FlowSequence, LiveChat, Reveal, ScrollProgress, Spotlight, TiltOnScroll, Typewriter } from "@/components/motion";

export const dynamic = "force-dynamic";

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
  { icon: <I.sparkle size={18} />, title: "Answers with receipts", body: "Ask anything about a contract, filing or report. Every answer links to the exact page and passage, highlighted in the document." },
  { icon: <I.layers size={18} />, title: "A searchable knowledge base", body: "Every upload is indexed page by page. Search or chat across your entire library, in any language, including scans after OCR." },
  { icon: <I.table size={18} />, title: "Extraction you can trust", body: "Pull key terms, deadlines, obligations, parties, financials and tables into clean spreadsheets. Risk flags are checked against your own playbook." },
  { icon: <I.edit size={18} />, title: "Real PDF editing", body: "Click any line to change it. Add text and images, highlight, and redact for real. Redacted pages are flattened, so hidden text is gone." },
  { icon: <I.sign size={18} />, title: "E-signatures built in", body: "Place fields, route to signers in order, send reminders. Every signed PDF ships with a certificate of completion and a SHA-256 fingerprint." },
  { icon: <I.bolt size={18} />, title: "Automations", body: "Risk review on upload, weekday digests, renewal reminders 60 days out, and Slack or Teams webhooks. No-code, and it runs while you sleep." },
  { icon: <I.convert size={18} />, title: "Convert anything", body: "Word, Excel, PowerPoint, text and images to PDF, and PDF back to Word, Excel, PowerPoint, JPG, PNG, WEBP and TIFF, with the formatting intact. Camera scans to PDF. Merge, split, reorder, watermark." },
  { icon: <I.lock size={18} />, title: "Team-grade control", body: "Check-out locks prevent conflicting edits. Hand-offs keep ownership clear. Every version is kept, with a full activity trail." },
  { icon: <I.inbox size={18} />, title: "Document requests", body: "Collect NDAs, W-9s and certificates from clients through a secure upload link, with due dates and reminders. No account needed on their side." },
];

export default async function Home() {
  const user = await currentUser();
  return (
    <div className="mk">
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
            <span className="live" /> Convert · Edit · Sign · Ask AI
          </span>
          <h1>
            Every document,
            <br />
            <Typewriter className="tw-word" words={TYPED} />
          </h1>
          <p className="lead">Convert, edit, sign and understand your PDFs in one place.</p>
          <div className="mk-cta">
            <Link className="btn btn-primary btn-lg btn-glow" href={user ? "/app" : "/signup"}>
              {user ? "Open your workbench" : "Start free — no card required"}
            </Link>
            <a className="btn btn-lg" href="#how">
              See how it works
            </a>
          </div>
          <TiltOnScroll>
            <div className="mk-shot" aria-hidden>
              <ProductShot />
            </div>
          </TiltOnScroll>
        </div>
      </section>

      <div className="marquee" aria-hidden style={{ marginTop: 40 }}>
        <div className="marquee-track">
          {[...MARQUEE_A, ...MARQUEE_A].map(([a, b], i) => (
            <span key={i} className="marquee-item">
              {a} <b>→</b> {b}
            </span>
          ))}
        </div>
      </div>
      <div className="marquee rev" aria-hidden style={{ borderTop: 0 }}>
        <div className="marquee-track">
          {[...MARQUEE_B, ...MARQUEE_B].map((t, i) => (
            <span key={i} className="marquee-item">
              {t}
            </span>
          ))}
        </div>
      </div>

      <section className="mk-section" style={{ paddingTop: 48, paddingBottom: 48 }}>
        <div className="stat-row">
          <Reveal className="stat" delay={0}>
            <b><CountUp to={1} /> page</b>
            <span>Every AI answer points to its source page</span>
          </Reveal>
          <Reveal className="stat" delay={120}>
            <b><CountUp to={12} /> formats</b>
            <span>In and out: Office, images, scans and text</span>
          </Reveal>
          <Reveal className="stat" delay={240}>
            <b><CountUp to={40} suffix="+" /> languages</b>
            <span>Searched, read aloud and understood</span>
          </Reveal>
          <Reveal className="stat" delay={360}>
            <b>0 re-keying</b>
            <span>Extract straight into Excel and CSV</span>
          </Reveal>
        </div>
      </section>

      <section className="mk-section" id="convert">
        <div className="mk-split">
          <Reveal>
            <div className="eyebrow">Convert</div>
            <h2 className="mk-h2" style={{ marginTop: 10 }}>
              Any format in. Any format out.
            </h2>
            <p className="mk-sub">Word, Excel and PowerPoint to PDF and back, with fonts, tables, bullets and spacing exactly where they were. Even scans and receipts come out editable.</p>
            <div className="mk-cta" style={{ justifyContent: "flex-start" }}>
              <Link className="btn btn-primary" href={user ? "/app" : "/signup"}>
                Convert a file now
              </Link>
            </div>
          </Reveal>
          <Reveal delay={150} className="card" style={{ padding: 0 }}>
            <ConvertDemo />
          </Reveal>
        </div>
      </section>

      <section className="mk-section" id="features">
        <Reveal>
          <div className="eyebrow">Features</div>
          <h2 className="mk-h2" style={{ marginTop: 10 }}>
            Everything a document goes through, in one place.
          </h2>
          <p className="mk-sub">Replace the converter tab, the e-sign subscription, the shared-drive scramble and the “which version is final?” email thread.</p>
        </Reveal>
        <Spotlight className="mk-grid">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} className="mk-card" delay={(i % 3) * 110}>
              <div className="mk-ico">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </Reveal>
          ))}
        </Spotlight>
      </section>

      <section className="mk-section" id="how">
        <div className="mk-split">
          <Reveal>
            <div className="eyebrow">How teams use pdftek</div>
            <h2 className="mk-h2" style={{ marginTop: 10 }}>
              From inbox to executed, without leaving the page.
            </h2>
            <ul className="mk-list">
              <li>A vendor MSA lands. An automation extracts risk flags against your playbook and pings #legal.</li>
              <li>Counsel asks “what&apos;s our exit path?” and gets the termination-for-convenience clause, with a link to page 2.</li>
              <li>They check the document out, redline the notice period in place, and save v3. Nobody else can overwrite it.</li>
              <li>They hand it to Contracts, who sends it for signature in order. Reminders go out automatically.</li>
              <li>Once it&apos;s fully signed, key terms go to the tracker, and a renewal reminder is set for 60 days before expiry.</li>
            </ul>
          </Reveal>
          <Reveal delay={150} className="card" style={{ padding: 20 }}>
            <FlowSequence steps={["📥 New PDF in library", "🔍 Extract risk flags", "🔔 Notify team"]} note="Instant, on upload" />
            <hr className="divider" />
            <FlowSequence steps={["✍️ Contract fully signed", "🔍 Extract key terms", "🔗 Webhook → tracker"]} note="Instant" />
            <hr className="divider" />
            <FlowSequence steps={["📅 Renewal in 60 days", "✉️ Email reminder"]} note="Daily check, 9:00 AM" />
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
              ].map(([t, b]) => (
                <div key={t} className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                  <span style={{ color: "var(--good)" }}>
                    <I.shield size={16} />
                  </span>
                  <div>
                    <b>{t}</b>
                    <div className="small muted">{b}</div>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={150}>
            <div className="eyebrow">Security</div>
            <h2 className="mk-h2" style={{ marginTop: 10 }}>
              Built for documents you can&apos;t afford to leak.
            </h2>
            <p className="mk-sub">
              Contracts, financials and patient records need more than a free converter site. pdftek keeps your files in your workspace, logs who touched what, and can run entirely on your own servers.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="mk-section" id="pricing">
        <div className="eyebrow">Pricing</div>
        <h2 className="mk-h2" style={{ marginTop: 10 }}>
          Simple plans that grow with your team.
        </h2>
        <p className="mk-sub">Start free. Upgrade a workspace when your team needs editing, signatures and automations. Every paid plan includes a 14-day trial.</p>
        <Reveal className="price-grid">
          <div className="price">
            <div className="eyebrow">Free</div>
            <div className="amount">$0</div>
            <div className="small muted">For individuals getting organized.</div>
            <ul>
              <li>Unlimited documents & versions</li>
              <li>Convert Word, Excel & PowerPoint to PDF and back</li>
              <li>Merge, split, organize, watermark</li>
              <li>AI chat & extraction (30/day)</li>
              <li>OCR, full-text search, read aloud</li>
            </ul>
            <Link href="/signup" className="btn btn-lg" style={{ marginTop: "auto" }}>
              Get started
            </Link>
          </div>
          <div className="price featured">
            <div className="row between">
              <div className="eyebrow" style={{ color: "var(--amber)" }}>Pro</div>
              <span className="badge badge-warn">Most popular</span>
            </div>
            <div className="amount">
              $19<span className="small muted" style={{ fontSize: 14, fontWeight: 400 }}> /user/mo</span>
            </div>
            <div className="small muted">For professionals running document workflows.</div>
            <ul>
              <li>Everything in Free</li>
              <li>Click-to-edit text, images & true redaction</li>
              <li>E-signatures with audit certificates</li>
              <li>Document requests & reminders</li>
              <li>Automations, digests & webhooks</li>
              <li>AI chat & extraction (300/day)</li>
            </ul>
            <Link href="/signup" className="btn btn-primary btn-lg" style={{ marginTop: "auto" }}>
              Start 14-day trial
            </Link>
          </div>
          <div className="price">
            <div className="eyebrow">Business</div>
            <div className="amount">
              $39<span className="small muted" style={{ fontSize: 14, fontWeight: 400 }}> /user/mo</span>
            </div>
            <div className="small muted">For legal, finance and research departments.</div>
            <ul>
              <li>Everything in Pro</li>
              <li>Multiple workspaces per team</li>
              <li>Admin roles & forced lock release</li>
              <li>Self-hosting option</li>
              <li>Priority support</li>
            </ul>
            <a href="mailto:sales@pdftek.app" className="btn btn-lg" style={{ marginTop: "auto" }}>
              Talk to sales
            </a>
          </div>
        </Reveal>
      </section>

      <section className="mk-section faq" id="faq" style={{ maxWidth: 820 }}>
        <h2 className="mk-h2">Questions, answered</h2>
        {[
          ["Does the AI make things up?", "pdftek answers only from your documents and cites the page for every claim. Click a citation and the passage is highlighted in the viewer, so you can check any answer in seconds."],
          ["Can it read scanned documents and other languages?", "Yes. The assistant reads scans directly, and in-browser OCR adds a searchable text layer in 13 languages. Search, read-aloud and conversions work across 40+ languages."],
          ["Are the e-signatures legally binding?", "pdftek captures consent, signer identity via unique email links, IP addresses and timestamps, and adds a certificate of completion to the signed PDF. That's the standard evidence under ESIGN and eIDAS for simple electronic signatures. Check your jurisdiction's requirements for regulated documents."],
          ["What happens when two people edit at once?", "They can't overwrite each other. Editing checks the document out to one person, and teammates see who holds the lock. You can hand it off or check it back in at any time, and admins can release a stale lock."],
          ["Can we host it ourselves?", "Yes. pdftek ships as a single Docker image with a built-in database and file storage. Bring your own Anthropic API key for the AI features and your own SMTP server for email."],
        ].map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>

      <Reveal as="section" className="mk-section" style={{ textAlign: "center", paddingTop: 40 }}>
        <Logo size={40} />
        <h2 className="mk-h2" style={{ marginTop: 16 }}>
          Your documents, finally under control.
        </h2>
        <div className="mk-cta">
          <Link className="btn btn-primary btn-lg" href={user ? "/app" : "/signup"}>
            {user ? "Open your workbench" : "Create your free workspace"}
          </Link>
        </div>
      </Reveal>

      <MarketingFooter />
    </div>
  );
}

function ProductShot() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "210px 1fr 290px", minHeight: 420, fontSize: 12 }} className="shot-grid">
      <div style={{ borderRight: "1px solid var(--line)", padding: 12 }}>
        <div className="eyebrow">Library</div>
        {["MSA — Northwind Supply.pdf", "DPA Amendment — Q3.pdf", "Vendor NDA — draft v4.pdf", "Board deck — FY25.pptx"].map((n, i) => (
          <div key={n} className={`doc-item ${i === 0 ? "active" : ""}`} style={{ marginTop: 6 }}>
            <div className="doc-icon">PDF</div>
            <div className="grow">
              <div className="doc-name ellipsis" style={{ fontSize: 12 }}>{n}</div>
              <div className="doc-sub">{[14, 6, 4, 22][i]} pages</div>
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
          <span className="chip active">Chat</span>
          <span className="chip">Extract</span>
          <span className="chip">Automate</span>
        </div>
        <LiveChat />
        <div className="row gap-4 wrap" style={{ marginTop: "auto" }}>
          <span className="chip">Compare to playbook</span>
          <span className="chip">Summarize §9</span>
        </div>
      </div>
    </div>
  );
}
