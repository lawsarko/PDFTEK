import Link from "next/link";
import { pageMeta } from "@/lib/seo-meta";
import { currentUser } from "@/lib/auth";
import { MarketingFooter, MarketingNav } from "@/components/marketing";
import { I } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { siteUrl } from "@/lib/seo-tools";
import { Reveal } from "@/components/motion";
import { FREE_LIMITS, PAID_LIMITS, PRO_SEATS, PRODUCTS, usd } from "@/lib/plans";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  return pageMeta("/how-it-works", {
    title: "How it works – A step-by-step guide to PDFTEK",
    description:
      "Learn how to use PDFTEK: convert PDFs to Word, Excel and images, merge and compress, edit, fill forms with AI, e-sign, turn bank statements into Excel and request documents securely.",
  });
}
export const dynamic = "force-dynamic";

type Plan = "free" | "member" | "ai";
type Guide = {
  id: string;
  icon: React.ReactNode;
  title: string;
  plan: Plan;
  intro: string;
  steps: string[];
  tip?: string;
  try: { label: string; href: string }[];
};

/** The guide, in the order people usually need it. Every step names the button they'll see. */
function guides(t: (s: string, v?: Record<string, string | number>) => string): Guide[] {
  return [
    {
      id: "start",
      icon: <I.bolt size={18} />,
      title: t("Get started"),
      plan: "free",
      intro: t("No sign-up needed. Click Start free and you land in your workbench: your document library on the left, the open document in the middle and the assistant on the right."),
      steps: [
        t("Click Start free on any page. You get a private workspace straight away."),
        t("Click Upload, or drag files onto the page. PDFs, Word, Excel, PowerPoint, JPG, PNG and TIFF all work; non-PDFs are converted to PDF as they upload."),
        t("Click a document in the library to open it. Its buttons appear above the page: Convert, Download, Compare, Edit, Fill form, Request signature and more."),
        t("Create a free account (Sign up) to keep your files and get {n} tasks a day instead of {g}.", { n: FREE_LIMITS.free.tasksPerDay, g: FREE_LIMITS.guest.tasksPerDay }),
      ],
      tip: t("Without an account, files are deleted after 24 hours. Sign up before you leave to keep them."),
      try: [{ label: t("Start free"), href: "/go/start" }],
    },
    {
      id: "convert",
      icon: <I.convert size={18} />,
      title: t("Convert PDFs and other files"),
      plan: "free",
      intro: t("Turn a PDF into an editable Word, Excel or PowerPoint file or into images, or turn almost any file into a PDF."),
      steps: [
        t("Open the PDF in your workbench."),
        t("Click Convert above the page and choose Word, Excel, PowerPoint, JPG, PNG, WEBP or TIFF."),
        t("The converted file downloads automatically. Your original PDF stays in the library."),
        t("To make a PDF, just upload the Word, Excel, PowerPoint, image or TIFF file. Several images can be combined in Tools → JPG/PNG → PDF."),
      ],
      tip: t("Scanned documents convert best after OCR: open the scan and click Run OCR when pdftek offers it."),
      try: [
        { label: t("PDF to Word"), href: "/go/pdf-to-word" },
        { label: t("PDF to Excel"), href: "/go/pdf-to-excel" },
        { label: t("Word to PDF"), href: "/go/word-to-pdf" },
      ],
    },
    {
      id: "organize",
      icon: <I.layers size={18} />,
      title: t("Merge, split, compress and protect"),
      plan: "free",
      intro: t("Everyday page tools live in Tools (top bar). Each one saves a new version or a new document, so nothing is lost."),
      steps: [
        t("Click Tools in the top bar and pick a tool: Merge, Split, Organize pages, Rotate, Compress, Watermark, Page numbers, Protect or Unlock."),
        t("Choose the document (or several, for Merge) and set the options."),
        t("Click the tool's button. The result opens in your library, ready to download."),
      ],
      tip: t("Made a mistake? Open the document, click ⋯ → Version history and restore an earlier version."),
      try: [
        { label: t("Merge PDFs"), href: "/go/merge" },
        { label: t("Compress PDF"), href: "/go/compress" },
        { label: t("Protect PDF"), href: "/go/protect" },
      ],
    },
    {
      id: "edit",
      icon: <I.edit size={18} />,
      title: t("Edit text, images and redact"),
      plan: "member",
      intro: t("Change the words in a PDF, add text and images, highlight, draw, and permanently remove sensitive information."),
      steps: [
        t("Open the PDF and click Edit."),
        t("Click any text to change it, or use the toolbar to add text, images, highlights, drawings and shapes."),
        t("To redact, choose Redact and drag over the content. Redacted areas are removed from the file, not just covered."),
        t("Click Save. Each save is a new version you can go back to."),
      ],
      try: [{ label: t("Edit a PDF"), href: "/go/edit" }],
    },
    {
      id: "forms",
      icon: <I.form size={18} />,
      title: t("Fill forms with AI"),
      plan: "ai",
      intro: t("pdftek finds every field in a form, even on a scan, and fills it from your saved details."),
      steps: [
        t("Open the form and click Fill form."),
        t("The first time, add your details to your profile (name, address, and so on). They're reused for every form."),
        t("Check the filled fields, answer anything pdftek asks, then sign and download."),
        t("Need the same form for many people? Upload a spreadsheet with one row per person and download them all as a ZIP (Day Pass, Pro or Team)."),
      ],
      tip: t("Your first AI-filled form each month is free."),
      try: [{ label: t("Fill a form"), href: "/go/fill-form" }],
    },
    {
      id: "sign",
      icon: <I.sign size={18} />,
      title: t("Get documents signed"),
      plan: "member",
      intro: t("Send a document to one or more people for e-signature, with reminders and a certificate of completion."),
      steps: [
        t("Open the document and click Request signature."),
        t("Add each signer's name and email, then place their signature, date and text fields on the pages."),
        t("Click Send. Signers get an email link and sign in their browser, with no account needed."),
        t("When everyone has signed, download the signed copy with its audit certificate from the Workflow tab."),
      ],
      try: [{ label: t("Request signatures"), href: "/go/sign" }],
    },
    {
      id: "excel",
      icon: <I.table size={18} />,
      title: t("Bank statements and invoices to Excel"),
      plan: "ai",
      intro: t("Turn PDF bank statements, invoices and receipts into clean spreadsheets, checked against their totals."),
      steps: [
        t("Click Tools → Bank statement → Excel or Invoices → Excel."),
        t("Upload your PDFs (or pick them from your library). Each one is read and checked against its balances or totals."),
        t("Review the rows, then download Excel or CSV for each file, or everything combined into one workbook."),
      ],
      tip: t("Your first statement or invoice each month is free. Combining many files into one spreadsheet needs a Day Pass, Pro or Team."),
      try: [
        { label: t("Bank statement to Excel"), href: "/go/bank-statement-to-excel" },
        { label: t("Invoice to Excel"), href: "/go/invoice-to-excel" },
      ],
    },
    {
      id: "requests",
      icon: <I.inbox size={18} />,
      title: t("Request documents from others"),
      plan: "member",
      intro: t("Collect files from clients, tenants or new hires through a private upload link protected by a one-time code."),
      steps: [
        t("Click Tools → Request documents."),
        t("Pick a template (tax, rental, ID verification, loans, onboarding) or list the documents you need."),
        t("Choose the security: a code emailed to the recipient, or an access code you give them by phone. Then click Send request."),
        t("Follow progress on the Document requests page: what's arrived, the audit trail, and Send back for anything that needs a new copy."),
      ],
      try: [{ label: t("Request documents"), href: "/go/request-documents" }],
    },
    {
      id: "ai",
      icon: <I.sparkle size={18} />,
      title: t("Ask AI and listen to documents"),
      plan: "ai",
      intro: t("Ask questions about a contract or report and get answers that point to the page they came from, or have any document read aloud."),
      steps: [
        t("Open a document and use Chat in the assistant panel on the right. Ask anything, like “When does this lease end?”"),
        t("Click a citation to jump to the exact page."),
        t("Use Extract to pull tables and key terms into a spreadsheet."),
        t("Click Read aloud to listen, with the voice, language and speed you choose (Day Pass, Pro or Team)."),
      ],
      try: [
        { label: t("Ask AI about a PDF"), href: "/go/ask" },
        { label: t("Read aloud"), href: "/go/read-aloud" },
      ],
    },
    {
      id: "team",
      icon: <I.users size={18} />,
      title: t("Work as a team"),
      plan: "member",
      intro: t("Share one library, pass documents between people and automate routine steps."),
      steps: [
        t("Open the account menu (top right) → Members, type a colleague's email and click Invite. Day Pass and Pro allow up to {n} people; Team is unlimited.", { n: PRO_SEATS }),
        t("Hand documents to a teammate from the Workflow tab or the Hand off button, so everyone knows whose turn it is."),
        t("Use Automate to react to new uploads or completed signatures, for example to extract key terms and notify the team."),
      ],
      try: [{ label: t("Compare plans"), href: "/pricing" }],
    },
  ];
}

export default async function HowItWorks() {
  const user = await currentUser();
  const { t, lp, info } = await getI18n();
  const list = guides(t);
  const PLAN: Record<Plan, [string, string]> = {
    free: [t("Free"), "badge-good"],
    member: [t("Day Pass, Pro or Team"), "badge-warn"],
    ai: [t("Uses AI credits"), "badge-info"],
  };

  return (
    <div className="mk">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "HowTo",
          inLanguage: info.tag,
          name: t("How to use PDFTEK"),
          step: list.map((g) => ({ "@type": "HowToSection", name: g.title, itemListElement: g.steps.map((s) => ({ "@type": "HowToStep", text: s })) })),
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "PDFTEK", item: `${siteUrl()}${lp("/")}` },
            { "@type": "ListItem", position: 2, name: t("How it works"), item: `${siteUrl()}${lp("/how-it-works")}` },
          ],
        }}
      />
      <MarketingNav signedIn={!!user && !user.is_guest} />

      <section className="mk-section" style={{ textAlign: "center", paddingBottom: 16 }}>
        <div className="eyebrow">{t("How it works")}</div>
        <h1 className="mk-h2" style={{ fontSize: "clamp(34px, 5vw, 54px)", marginTop: 10 }}>
          {t("Everything you can do with pdftek, step by step.")}
        </h1>
        <p className="mk-sub" style={{ margin: "14px auto 0" }}>
          {t("Most tools are free and need no account. Pick what you want to do below, follow the steps, or jump straight in.")}
        </p>
        <div className="mk-cta" style={{ justifyContent: "center" }}>
          <Link prefetch={false} className="btn btn-primary btn-lg" href={user ? "/app" : "/go/start"}>
            {user ? t("Open your workbench") : t("Start free — no sign-up needed")}
          </Link>
        </div>
      </section>

      <section className="mk-section" style={{ paddingTop: 0 }}>
        <ol className="hiw-basics">
          {[
            [t("Upload"), t("Drop in a PDF, Word, Excel, image or scan.")],
            [t("Pick a tool"), t("Convert, edit, sign, fill, merge, ask AI…")],
            [t("Download or share"), t("Get the file, or send it for signature.")],
          ].map(([h, b], i) => (
            <li key={h}>
              <span className="hiw-num">{i + 1}</span>
              <b>{h}</b>
              <span className="small muted">{b}</span>
            </li>
          ))}
        </ol>

        <nav className="hiw-jump" aria-label={t("Guides")}>
          {list.map((g) => (
            <a key={g.id} href={`#${g.id}`}>
              {g.icon} {g.title}
            </a>
          ))}
        </nav>

        <div className="hiw-guides">
          {list.map((g) => (
            <Reveal key={g.id} className="hiw-guide">
              <article id={g.id}>
                <header className="row between wrap" style={{ gap: 10 }}>
                  <h2 className="row" style={{ gap: 10, margin: 0, fontSize: 22 }}>
                    <span className="hiw-ico">{g.icon}</span>
                    {g.title}
                  </h2>
                  <span className={`badge ${PLAN[g.plan][1]}`}>{PLAN[g.plan][0]}</span>
                </header>
                <p className="muted" style={{ lineHeight: 1.6 }}>
                  {g.intro}
                </p>
                <ol className="hiw-steps">
                  {g.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                {g.tip && (
                  <p className="hiw-tip small">
                    <I.info size={13} /> {g.tip}
                  </p>
                )}
                <div className="row wrap" style={{ gap: 8 }}>
                  {g.try.map((x, i) => (
                    <Link key={x.href} prefetch={false} className={`btn btn-sm ${i === 0 ? "btn-primary" : ""}`} href={x.href.startsWith("/go/") ? x.href : lp(x.href)}>
                      {x.label} <I.right size={12} />
                    </Link>
                  ))}
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mk-section" style={{ maxWidth: 900 }}>
        <h2 className="mk-h2">{t("Free, Day Pass, Pro or Team?")}</h2>
        <div className="hiw-plans mt-16">
          <div>
            <b>{t("Free")}</b>
            <span className="small muted">
              {t("{a} tasks a day without an account, {b} with one. Files up to {mb} MB.", { a: FREE_LIMITS.guest.tasksPerDay, b: FREE_LIMITS.free.tasksPerDay, mb: FREE_LIMITS.free.maxFileMb })}
            </span>
          </div>
          <div>
            <b>
              {t("Day Pass")} · {usd(PRODUCTS.pass.cents)}
            </b>
            <span className="small muted">{t("Everything in Pro for 24 hours. No subscription.")}</span>
          </div>
          <div>
            <b>
              {t("Pro")} · {usd(PRODUCTS.pro_month.cents)}
              {t("/month")}
            </b>
            <span className="small muted">
              {t("Unlimited tasks, files up to {mb} MB, editing, e-signatures, requests and 400 AI credits a month.", { mb: PAID_LIMITS.maxFileMb })}
            </span>
          </div>
          <div>
            <b>
              {t("Team")} · {usd(PRODUCTS.team_month.cents)}
              {t("/month")}
            </b>
            <span className="small muted">{t("Everything in Pro for unlimited people, with 1,500 AI credits a month.")}</span>
          </div>
        </div>
        <Link href={lp("/pricing")} className="compare-more" style={{ textAlign: "left" }}>
          {t("Compare every feature")} →
        </Link>
      </section>

      <section className="mk-section faq" style={{ maxWidth: 820 }}>
        <h2 className="mk-h2">{t("Common questions")}</h2>
        {[
          [t("My file won't convert. What should I do?"), t("Check that it's under the size limit ({mb} MB free, {max} MB on paid plans) and not password-protected; if it is, use Tools → Unlock PDF first. Scans convert better after OCR. Still stuck? Contact us and tell us which tool and file type.", { mb: FREE_LIMITS.free.maxFileMb, max: PAID_LIMITS.maxFileMb })],
          [t("Where are my files, and who can see them?"), t("In your workspace library, visible only to you and people you invite. Files from visitors without an account are deleted after 24 hours. Delete any file yourself with ⋯ → Move to trash.")],
          [t("How do I change the language?"), t("Use the language menu at the bottom of any page, or Language in the account menu inside the app.")],
          [t("What are AI credits?"), t("AI features (chat, AI form filling, statements and invoices to Excel) are charged in credits based on what each request costs. Packs start at {price} and never expire; Pro includes 400 a month.", { price: usd(PRODUCTS.credits_250.cents) })],
          [t("Do people I send documents to need an account?"), t("No. Signers and people you request documents from just open the link in their email.")],
        ].map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
        <p className="small muted mt-16">
          {t("Need more help?")} <Link href={lp("/contact")}>{t("Contact us")}</Link>
        </p>
      </section>

      <MarketingFooter />
    </div>
  );
}
