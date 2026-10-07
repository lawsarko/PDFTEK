import Link from "next/link";
import { Logo, Wordmark } from "./icons";
import { MarketingMenu } from "./marketing-menu";

export function MarketingNav({ signedIn }: { signedIn: boolean }) {
  return (
    <nav className="mk-nav">
      <div className="mk-nav-inner">
        <Link href="/" className="brand">
          <Logo /> <Wordmark />
        </Link>
        <MarketingMenu />
        <span className="grow" />
        {signedIn ? (
          <Link className="btn btn-primary btn-sm" href="/app">
            Open workbench
          </Link>
        ) : (
          <>
            <Link className="btn btn-ghost btn-sm" href="/login">
              Sign in
            </Link>
            <Link className="btn btn-primary btn-sm" href="/signup">
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
      <div className="mk-footer-inner">
        <div className="col gap-8">
          <span className="brand">
            <Logo /> <Wordmark />
          </span>
          <span>The document workbench for professional teams.</span>
        </div>
        <div className="row gap-24 wrap">
          <Link href="/#convert">Convert</Link>
          <Link href="/#features">Features</Link>
          <Link href="/#how">How it works</Link>
          <Link href="/#security">Security</Link>
          <Link href="/#faq">FAQ</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <a href="mailto:support@pdftek.app">Support</a>
        </div>
        <span>© {new Date().getFullYear()} pdftek</span>
      </div>
    </footer>
  );
}
