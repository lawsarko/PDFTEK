import { Suspense } from "react";
import { currentUser } from "@/lib/auth";
import { MarketingFooter, MarketingNav } from "@/components/marketing";
import { ContactForm } from "./contact-form";
import { I } from "@/components/icons";

export const metadata = {
  title: "Contact us",
  description: "Questions about pdftek, billing, a problem with a PDF tool, or an idea for a feature? Send us a message and we'll get back to you by email.",
  alternates: { canonical: "/contact" },
};
export const dynamic = "force-dynamic";

export default async function Contact() {
  const user = await currentUser();
  const me = user && !user.is_guest ? { name: user.name, email: user.email } : null;
  return (
    <div className="mk">
      <MarketingNav signedIn={!!me} />
      <section className="mk-section contact-wrap">
        <div className="contact-intro">
          <h1 className="mk-h2">Contact us</h1>
          <p className="muted" style={{ lineHeight: 1.7 }}>
            Questions, billing, a file that won&apos;t convert, or an idea for pdftek? Send a message and a real person will reply by email.
          </p>
          <p className="contact-hours">
            <I.clock size={15} /> We respond within 24 hours, Monday to Friday, 9am to 5pm CDT.
          </p>
          <ul className="contact-points">
            <li>
              <b>Billing or a purchase?</b> Include the email you paid with so we can find it quickly.
            </li>
            <li>
              <b>Something not working?</b> Tell us which tool, what you expected and what happened. Please don&apos;t send passwords or card numbers.
            </li>
          </ul>
        </div>
        <Suspense>
          <ContactForm me={me} />
        </Suspense>
      </section>
      <MarketingFooter />
    </div>
  );
}
