import { currentUser } from "@/lib/auth";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { CreditPacks, PlanCards } from "@/components/pricing";
import { PRICING_FAQ } from "@/lib/plans";
import { Reveal } from "@/components/motion";

export const metadata = { title: "Pricing", description: "Free PDF tools for everyone. Day Pass $1.99, Pro $5.99/month, pay-as-you-go AI credits." };
export const dynamic = "force-dynamic";

const ROWS: [string, string, string, string, string][] = [
  ["Convert, merge, split, compress, protect…", "10–20 / day", "Unlimited", "Unlimited", "Unlimited"],
  ["Max file size", "20 MB", "100 MB", "100 MB", "100 MB"],
  ["Files at once", "5", "50", "50", "50"],
  ["Read and search PDFs", "✓", "✓", "✓", "✓"],
  ["Edit text, images, redact", "—", "✓", "✓", "✓"],
  ["Read aloud", "—", "✓", "✓", "✓"],
  ["E-signatures with audit trail", "—", "✓", "✓", "✓"],
  ["Automations & document requests", "—", "✓", "✓", "✓"],
  ["AI credits included", "Buy as needed", "50", "400 / month", "1,500 / month"],
  ["People", "1", "1", "1", "Up to 5"],
];

export default async function Pricing() {
  const user = await currentUser();
  return (
    <div className="mk">
      <MarketingNav signedIn={!!user} />
      <section className="mk-section" style={{ textAlign: "center", paddingBottom: 24 }}>
        <div className="eyebrow">Pricing</div>
        <h1 className="mk-h2" style={{ fontSize: "clamp(34px, 5vw, 54px)", marginTop: 10 }}>
          Free for everyday PDFs. <span style={{ color: "var(--amber)" }}>Fair</span> when you need more.
        </h1>
        <p className="mk-sub" style={{ margin: "14px auto 0" }}>
          No account needed for the free tools. Pay once for a day, or go Pro for less than a coffee a month.
        </p>
      </section>
      <section className="mk-section" style={{ paddingTop: 0 }}>
        <PlanCards />
      </section>
      <section className="mk-section" style={{ paddingTop: 0 }}>
        <Reveal className="mk-split" style={{ alignItems: "start" }}>
          <div>
            <div className="eyebrow">Pay as you go</div>
            <h2 className="mk-h2" style={{ marginTop: 10 }}>AI credits, only when you use them.</h2>
            <p className="mk-sub">
              Ask questions about a contract, summarize a report or pull figures into Excel. AI is charged on what each request actually costs, so a quick
              question uses a few credits. Credits also cover extra tasks beyond the free daily limit. They never expire.
            </p>
          </div>
          <CreditPacks />
        </Reveal>
      </section>
      <section className="mk-section">
        <Reveal>
          <h2 className="mk-h2">Compare plans</h2>
          <div className="table-wrap mt-16">
            <table className="table compare-table">
              <thead>
                <tr>
                  <th />
                  <th>Free</th>
                  <th>Day Pass</th>
                  <th>Pro</th>
                  <th>Team</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r[0]}>
                    {r.map((c, i) => (
                      <td key={i} className={i ? "small" : ""}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </section>
      <section className="mk-section faq" style={{ maxWidth: 820 }}>
        <h2 className="mk-h2">Pricing questions</h2>
        {PRICING_FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
      <MarketingFooter />
    </div>
  );
}
