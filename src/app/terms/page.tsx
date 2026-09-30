import { LegalPage } from "@/components/legal";

export const metadata = { title: "Terms of Service" };

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="September 2026"
      sections={[
        ["Using pdftek", "You may use pdftek to store, convert, edit, sign and analyze documents that you have the right to process. You are responsible for your account credentials and for activity in workspaces you own."],
        ["Your content", "You keep all rights to documents you upload. You grant pdftek only the limited permission needed to host, process and display them to you and the people you share them with."],
        ["AI features", "AI answers, extractions and summaries are generated from your documents and include citations so you can verify them. They are not legal, financial or professional advice. Review important outputs before relying on them."],
        ["Electronic signatures", "pdftek records signer consent, identity via unique links, IP addresses and timestamps, and attaches a certificate of completion. You are responsible for confirming electronic signatures are appropriate for your documents and jurisdiction."],
        ["Plans and billing", "Paid plans renew automatically until cancelled. Trials convert to the Free plan unless you subscribe. Fees are non-refundable except where required by law."],
        ["Acceptable use", "Do not upload unlawful content, attempt to access other workspaces, abuse public request or signing links, or interfere with the service."],
        ["Liability", "pdftek is provided as-is. To the extent permitted by law, our aggregate liability is limited to the fees you paid in the twelve months before the claim."],
      ]}
    />
  );
}
