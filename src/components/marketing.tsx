import Link from "next/link";
import { Logo, Wordmark } from "./icons";
import { MarketingMenu } from "./marketing-menu";
import { SEO_TOOLS } from "@/lib/seo-tools";

export function MarketingNav({ signedIn }: { signedIn: boolean }) {
  return (
    <nav className="mk-nav">
      <div className="mk-nav-inner">
        <Link href="/" className="brand">
          <Logo /> <Wordmark />
        </Link>
        <MarketingMenu />
        <span className="grow" />
        <Link href="/pricing" className="mk-link hide-mobile">
          Pricing
        </Link>
        {signedIn ? (
          <Link className="btn btn-primary btn-sm" href="/app">
            Open workbench
          </Link>
        ) : (
          <>
            <Link className="btn btn-ghost btn-sm" href="/login">
              Sign in
            </Link>
            <Link prefetch={false} className="btn btn-primary btn-sm" href="/go/start">
              Start free
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}

export function MarketingFooter() {
  return (
    <footer className="mk-footer">
      <nav className="mk-footer-tools" aria-label="PDF tools">
        {SEO_TOOLS.map((t) => (
          <Link key={t.slug} href={`/${t.slug}`}>
            {t.name}
          </Link>
        ))}
      </nav>
      <div className="mk-footer-inner">
        <div className="col gap-8">
          <span className="brand">
            <Logo /> <Wordmark />
          </span>
          <span>The document workbench for professional teams.</span>
        </div>
        <div className="row gap-24 wrap">
          <Link href="/tools">All PDF tools</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/#convert">Convert</Link>
          <Link href="/#features">Features</Link>
          <Link href="/#how">How it works</Link>
          <Link href="/#security">Security</Link>
          <Link href="/#faq">FAQ</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/contact">Contact us</Link>
        </div>
        <span>© {new Date().getFullYear()} PDFTEK</span>
      </div>
      <p className="mk-footer-made">
        Made in Chicago, USA with love <span className="heart" aria-hidden="true">♥</span>
      </p>
    </footer>
  );
}
