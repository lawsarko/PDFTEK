import { currentUser } from "@/lib/auth";
import { MarketingFooter, MarketingNav } from "./marketing";

export async function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: [string, string][] }) {
  const user = await currentUser();
  return (
    <div className="mk">
      <MarketingNav signedIn={!!user} />
      <article className="mk-section" style={{ maxWidth: 760 }}>
        <h1 className="mk-h2">{title}</h1>
        <p className="small faint">Last updated {updated}</p>
        {sections.map(([h, body]) => (
          <section key={h} style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 18 }}>{h}</h2>
            <p className="muted" style={{ lineHeight: 1.7 }}>{body}</p>
          </section>
        ))}
      </article>
      <MarketingFooter />
    </div>
  );
}
