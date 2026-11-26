/**
 * Sample pages for the homepage demos. They're pictures of English sample documents (not interface
 * text), so scripts/i18n-extract.mjs leaves this file out of the translation catalog.
 */
export type DocKind = "invoice" | "contract" | "statement" | "report" | "budget" | "deck" | "receipt";

/** Pages for the live scanner, in order. */
export const SCAN_PAGES: DocKind[] = ["invoice", "contract", "statement"];
/** Pages for the conversion demo, one per example (Q3 report, Contract, Budget, Pitch deck, Receipt scan). */
export const CONVERT_PAGES: DocKind[] = ["report", "contract", "budget", "deck", "receipt"];

/**
 * A small, realistic sample page (an invoice, a contract, a bank statement…) drawn with real text,
 * for the homepage's animated demos. It's an English sample document, so it isn't translated.
 */
export function DocSheet({ kind, sheet = false }: { kind: DocKind; sheet?: boolean }) {
  const rows = (r: [string, string, string][], cls = "") => (
    <table className={`ds-table ${cls}`}>
      <tbody>
        {r.map(([a, b, c], i) => (
          <tr key={i}>
            <td>{a}</td>
            <td>{b}</td>
            <td>{c}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const para = (n: number, widths = [100, 96, 98, 72]) => (
    <div className="ds-para">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ width: `${widths[i % widths.length]}%` }} />
      ))}
    </div>
  );
  let body: React.ReactNode;
  switch (kind) {
    case "invoice":
      body = (
        <>
          <div className="ds-head">
            <span className="ds-logo" />
            <div className="grow">
              <b>Northwind Supply Co.</b>
              <span>1180 N Halsted St, Chicago, IL</span>
            </div>
            <div className="ds-right">
              <b className="ds-big">INVOICE</b>
              <span>No. 10482 · Oct 14, 2026</span>
            </div>
          </div>
          <div className="ds-meta">
            <div>
              <span>Bill to</span>
              <b>Harbor &amp; Pine LLC</b>
              <span>220 W Lake St, Chicago, IL</span>
            </div>
            <div className="ds-right">
              <span>Due</span>
              <b>Nov 13, 2026</b>
            </div>
          </div>
          {rows([["Description", "Qty", "Amount"], ["Office chairs", "6", "$1,740.00"], ["Standing desks", "3", "$2,385.00"], ["Delivery & setup", "1", "$180.00"]], "head")}
          <div className="ds-totals">
            <span>Subtotal</span><b>$4,305.00</b>
            <span>Tax 10.25%</span><b>$441.26</b>
            <span className="ds-total">Total due</span><b className="ds-total">$4,746.26</b>
          </div>
          <div className="ds-foot">Thank you for your business. Payment due within 30 days.</div>
        </>
      );
      break;
    case "statement":
      body = (
        <>
          <div className="ds-head">
            <span className="ds-logo ds-logo-blue" />
            <div className="grow">
              <b>Lakeshore Bank</b>
              <span>Account statement · September 2026</span>
            </div>
          </div>
          <div className="ds-summary">
            <div><span>Opening</span><b>$8,214.50</b></div>
            <div><span>In</span><b className="ds-pos">+$6,420.00</b></div>
            <div><span>Out</span><b className="ds-neg">−$3,118.72</b></div>
          </div>
          {rows([["Date", "Description", "Amount"], ["09/02", "Payroll deposit", "+$3,210.00"], ["09/05", "Rent · 4410 Clark St", "−$1,850.00"], ["09/09", "Office Depot #1182", "−$214.37"], ["09/16", "Payroll deposit", "+$3,210.00"], ["09/21", "ComEd electric", "−$96.15"], ["09/28", "Transfer to savings", "−$958.20"]], "head ds-money")}
          <div className="ds-foot">Closing balance $11,515.78</div>
        </>
      );
      break;
    case "contract":
      body = (
        <>
          <div className="ds-title">Mutual Non-Disclosure Agreement</div>
          <p className="ds-text">This Agreement is made on October 14, 2026 between Harbor &amp; Pine LLC and Northwind Supply Co.</p>
          <p className="ds-text"><b>1. Purpose.</b> The parties wish to share confidential information to evaluate a possible supply partnership.</p>
          {para(3)}
          <p className="ds-text"><b>2. Term.</b> This Agreement lasts two (2) years from the date above.</p>
          {para(2, [100, 64])}
          <div className="ds-signs">
            <div>
              <svg viewBox="0 0 80 22" className="ds-sig"><path d="M2 16c6-10 10-12 12-6s-2 9 3 3 7-11 9-5 1 8 6 2c3-4 5-6 7-1s4 3 8-2 7-3 10 1 8 2 14-4" /></svg>
              <span>J. Rivera</span>
            </div>
            <div>
              <svg viewBox="0 0 80 22" className="ds-sig"><path d="M3 14c4-6 9-11 11-4 1 5-3 8 2 4s9-12 11-6-4 8 3 4 9-9 12-4 4 6 10 1 9-5 15-2" /></svg>
              <span>A. Chen</span>
            </div>
          </div>
        </>
      );
      break;
    case "report":
      body = (
        <>
          <div className="ds-title">Q3 Operating Report</div>
          <p className="ds-text">Revenue grew 18% over Q2, led by new enterprise accounts in the Midwest region.</p>
          <div className="ds-bars">
            {[38, 52, 47, 66, 74, 88].map((h, i) => (
              <i key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
          {para(4)}
          <p className="ds-text"><b>Outlook.</b> We expect Q4 margins to hold at 31%.</p>
          {para(2, [100, 58])}
        </>
      );
      break;
    case "budget":
      body = (
        <>
          <div className="ds-title">FY27 Department Budget</div>
          {rows([["Line item", "Q1", "Q2"], ["Salaries", "$412,000", "$418,500"], ["Software", "$38,400", "$38,400"], ["Travel", "$12,750", "$9,900"], ["Facilities", "$64,200", "$64,200"], ["Marketing", "$51,000", "$72,300"], ["Total", "$578,350", "$603,300"]], `head ds-money ${sheet ? "as-sheet" : ""}`)}
          {para(2, [92, 60])}
        </>
      );
      break;
    case "deck":
      body = (
        <>
          <div className="ds-slide">
            <b>Why now</b>
            <span>Teams handle 3× more documents than in 2020.</span>
            <div className="ds-bars ds-bars-slide">
              {[30, 45, 62, 84].map((h, i) => (
                <i key={i} style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
          <div className="ds-slide ds-slide-2">
            <b>Our plan</b>
            {para(3, [90, 76, 60])}
          </div>
        </>
      );
      break;
    case "receipt":
      body = (
        <div className="ds-receipt">
          <b>GREEN CITY MARKET</b>
          <span>771 W Fullerton · Chicago</span>
          <span>10/14/2026 · 12:41 PM</span>
          {rows([["Coffee beans", "1", "$14.99"], ["Oat milk", "2", "$7.98"], ["Notebooks", "3", "$11.25"], ["Pens (12)", "1", "$6.49"]])}
          <div className="ds-totals">
            <span className="ds-total">TOTAL</span><b className="ds-total">$40.71</b>
          </div>
          <span>VISA •••• 4421 · APPROVED</span>
        </div>
      );
      break;
  }
  return (
    <div className={`doc-sheet ds-${kind}`} dir="ltr" data-no-translate>
      {body}
    </div>
  );
}

