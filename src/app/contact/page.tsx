import { Suspense } from "react";
import { pageMeta } from "@/lib/seo-meta";
import { currentUser } from "@/lib/auth";
import { MarketingFooter, MarketingNav } from "@/components/marketing";
import { ContactForm } from "./contact-form";
import { I } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { siteUrl } from "@/lib/seo-tools";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  return pageMeta("/contact", {
    title: "Contact us",
    description: "Questions about pdftek, billing, a problem with a PDF tool, or an idea for a feature? Send us a message and we'll get back to you by email.",
  });
}
export const dynamic = "force-dynamic";

export default async function Contact() {
  const user = await currentUser();
  const me = user && !user.is_guest ? { name: user.name, email: user.email } : null;
  const { t, lp, info } = await getI18n();
  return (
    <div className="mk">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ContactPage",
          inLanguage: info.tag,
          url: `${siteUrl()}${lp("/contact")}`,
          about: {
            "@type": "Organization",
            name: "PDFTEK",
            url: siteUrl(),
            contactPoint: {
              "@type": "ContactPoint",
              contactType: "customer support",
              availableLanguage: ["English"],
              hoursAvailable: { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "09:00", closes: "17:00" },
              url: `${siteUrl()}/contact`,
            },
          },
        }}
      />
      <MarketingNav signedIn={!!me} />
      <section className="mk-section contact-wrap">
        <div className="contact-intro">
          <h1 className="mk-h2">{t("Contact us")}</h1>
          <p className="muted" style={{ lineHeight: 1.7 }}>
            {t("Questions, billing, a file that won't convert, or an idea for pdftek? Send a message and a real person will reply by email.")}
          </p>
          <p className="contact-hours">
            <I.clock size={15} /> {t("We respond within 24 hours, Monday to Friday, 9am to 5pm Central Time (CT).")}
          </p>
          <ul className="contact-points">
            <li>
              <b>{t("Billing or a purchase?")}</b> {t("Include the email you paid with so we can find it quickly.")}
            </li>
            <li>
              <b>{t("Something not working?")}</b> {t("Tell us which tool, what you expected and what happened. Please don't send passwords or card numbers.")}
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
