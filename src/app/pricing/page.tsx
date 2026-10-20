import { Fragment } from "react";
import { currentUser } from "@/lib/auth";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { CreditPacks, PlanCards } from "@/components/pricing";
import { FREE_LIMITS, PRICING_FAQ } from "@/lib/plans";
import { Reveal } from "@/components/motion";
import { I } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { alternatesFor, getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t, locale } = await getI18n();
  return {
    title: t("Pricing – Free PDF Tools, $1.99 Day Pass, Pro $5.99/mo"),
    description: t("Free PDF tools for everyone, no sign-up. Day Pass $1.99 for 24 hours, Pro $5.99/month, and pay-as-you-go AI credits that never expire."),
    alternates: alternatesFor("/pricing", locale),
  };
}
export const dynamic = "force-dynamic";

type Cell = boolean | string;
type Row = [string, Cell, Cell, Cell, Cell];

/** Every feature, by plan (Free, Day Pass, Pro, Team), grouped the way people look for them. */
function compareGroups(t: (s: string, v?: Record<string, string | number>) => string): { group: string; rows: Row[] }[] {
  const unlimited = t("Unlimited");
  const credits = t("Uses credits");
  return [
    {
      group: t("Usage"),
      rows: [
        [t("Tasks a day"), t("{a} ({b} with a free account)", { a: FREE_LIMITS.guest.tasksPerDay, b: FREE_LIMITS.free.tasksPerDay }), unlimited, unlimited, unlimited],
        [t("Max file size"), `${FREE_LIMITS.free.maxFileMb} MB`, "100 MB", "100 MB", "100 MB"],
        [t("Files at once"), String(FREE_LIMITS.free.maxFiles), "50", "50", "50"],
        [t("AI credits included"), t("Buy as needed"), "50", t("400 / month"), t("1,500 / month")],
        [t("People"), "1", "1", "1", t("Up to 5")],
      ],
    },
    {
      group: t("Convert"),
      rows: [
        [t("PDF to Word, Excel and PowerPoint"), true, true, true, true],
        [t("PDF to JPG, PNG, WEBP and TIFF"), true, true, true, true],
        [t("Word, Excel, PowerPoint, images and TIFF to PDF"), true, true, true, true],
        [t("Scan to PDF with your camera"), true, true, true, true],
        [t("OCR: make scans searchable"), true, true, true, true],
        [t("Bulk convert many PDFs to Word or Excel (one ZIP)"), false, true, true, true],
      ],
    },
    {
      group: t("Organize and optimize"),
      rows: [
        [t("Merge, split, extract, delete and reorder pages"), true, true, true, true],
        [t("Rotate, watermark and page numbers"), true, true, true, true],
        [t("Compress PDF"), true, true, true, true],
        [t("Password-protect and unlock"), true, true, true, true],
        [t("Compare two documents"), true, true, true, true],
      ],
    },
    {
      group: t("Edit"),
      rows: [
        [t("Edit existing text and images"), false, true, true, true],
        [t("Add text, highlight, draw and shapes"), false, true, true, true],
        [t("True redaction (content removed, not just covered)"), false, true, true, true],
      ],
    },
    {
      group: t("Forms and signatures"),
      rows: [
        [t("Fill and sign forms yourself"), true, true, true, true],
        [t("AI form filler"), t("1 form / month"), credits, credits, credits],
        [t("Fill many forms from a spreadsheet"), false, true, true, true],
        [t("E-signature requests with audit certificates"), false, true, true, true],
        [t("Document requests (collect files from others)"), false, true, true, true],
      ],
    },
    {
      group: t("AI and data"),
      rows: [
        [t("Chat with PDFs, answers cite the page"), credits, credits, credits, credits],
        [t("Bank statements and invoices to Excel"), t("1 document / month"), credits, credits, credits],
        [t("Many statements or invoices into one spreadsheet"), false, true, true, true],
        [t("Read aloud in 11 languages"), false, true, true, true],
      ],
    },
    {
      group: t("Workflow and teams"),
      rows: [
        [t("Automations"), false, true, true, true],
        [t("Shared library, roles and hand-offs"), false, false, false, true],
      ],
    },
  ];
}

function CellView({ c, yes, no }: { c: Cell; yes: string; no: string }) {
  if (c === true)
    return (
      <span className="yes" title={yes}>
        <I.check size={15} />
        <span className="sr-only">{yes}</span>
      </span>
    );
  if (c === false)
    return (
      <span className="no" title={no}>
        —<span className="sr-only">{no}</span>
      </span>
    );
  return <>{c}</>;
}

export default async function Pricing() {
  const user = await currentUser();
  const { t, info } = await getI18n();
  return (
    <div className="mk">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          inLanguage: info.tag,
          mainEntity: PRICING_FAQ.map(([q, a]) => ({ "@type": "Question", name: t(q), acceptedAnswer: { "@type": "Answer", text: t(a) } })),
        }}
      />
      <MarketingNav signedIn={!!user} />
      <section className="mk-section" style={{ textAlign: "center", paddingBottom: 24 }}>
        <div className="eyebrow">{t("Pricing")}</div>
        <h1 className="mk-h2" style={{ fontSize: "clamp(34px, 5vw, 54px)", marginTop: 10 }}>
          {t("Free for everyday PDFs.")} <span style={{ color: "var(--amber)" }}>{t("Fair")}</span> {t("when you need more.")}
        </h1>
        <p className="mk-sub" style={{ margin: "14px auto 0" }}>
          {t("No account needed for the free tools. Pay once for a day, or go Pro for less than a coffee a month.")}
        </p>
      </section>
      <section className="mk-section" style={{ paddingTop: 0 }}>
        <PlanCards />
        <a href="#compare" className="compare-more">
          {t("See every feature by plan")} ↓
        </a>
        <p className="secure-note">
          <I.lock size={14} /> {t("Payments are processed securely by Stripe. pdftek never sees or stores your card details.")}
        </p>
      </section>
      <section className="mk-section" style={{ paddingTop: 0 }}>
        <Reveal className="mk-split" style={{ alignItems: "start" }}>
          <div>
            <div className="eyebrow">{t("Pay as you go")}</div>
            <h2 className="mk-h2" style={{ marginTop: 10 }}>{t("AI credits, only when you use them.")}</h2>
            <p className="mk-sub">
              {t("Ask questions about a contract, summarize a report or pull figures into Excel. AI is charged on what each request actually costs, so a quick question uses a few credits. Credits also cover extra tasks beyond the free daily limit. They never expire.")}
            </p>
          </div>
          <CreditPacks />
        </Reveal>
      </section>
      <section className="mk-section" id="compare">
        <Reveal>
          <h2 className="mk-h2">{t("Compare plans")}</h2>
          <p className="mk-sub">{t("Every feature, plan by plan. AI features use credits, charged on what each request actually costs.")}</p>
          <div className="table-wrap mt-16">
            <table className="table compare-table">
              <thead>
                <tr>
                  <th>{t("Feature")}</th>
                  <th>{t("Free")}</th>
                  <th>{t("Day Pass")}</th>
                  <th>{t("Pro")}</th>
                  <th>{t("Team")}</th>
                </tr>
              </thead>
              <tbody>
                {compareGroups(t).map(({ group, rows }) => (
                  <Fragment key={group}>
                    <tr className="compare-group">
                      <td colSpan={5}>{group}</td>
                    </tr>
                    {rows.map((r) => (
                      <tr key={r[0]}>
                        <td>{r[0]}</td>
                        {r.slice(1).map((c, i) => (
                          <td key={i} className="small">
                            <CellView c={c} yes={t("Included")} no={t("Not included")} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </section>
      <section className="mk-section faq" style={{ maxWidth: 820 }}>
        <h2 className="mk-h2">{t("Pricing questions")}</h2>
        {PRICING_FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{t(q)}</summary>
            <p>{t(a)}</p>
          </details>
        ))}
      </section>
      <MarketingFooter />
    </div>
  );
}
