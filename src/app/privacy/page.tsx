import { LegalPage } from "@/components/legal";
import { pageMeta } from "@/lib/seo-meta";

export async function generateMetadata() {
  return pageMeta("/privacy", {
    title: "Privacy Policy",
    description: "How PDFTEK handles your files and data: HTTPS transfer, private workspaces, no AI training on your documents, and automatic deletion of files from visitors without an account.",
  });
}

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="September 2026"
      sections={[
        ["What we collect", "Account details (name, email, hashed password), the documents and metadata you upload, activity logs, and technical data such as IP addresses recorded for security and signature audit trails."],
        ["How we use it", "To provide the service: storing and processing your documents, running features you invoke, sending the emails you trigger, and securing accounts. We do not sell personal data or use your documents to train models."],
        ["AI processing", "When you use AI features, the relevant document content is sent to our model provider (Anthropic) solely to generate the response you requested, under their commercial data terms."],
        ["Analytics", "We use Google Analytics to understand how visitors use the website (pages viewed, device and approximate location). It sets cookies and does not receive the content of your documents."],
        ["OCR", "Optical character recognition runs in your browser; the resulting text is stored in your workspace to power search."],
        ["Sharing", "Documents are visible only to members of the workspace they belong to, and to external recipients you explicitly send signing or request links to."],
        ["Retention and deletion", "Deleted documents move to trash and can be restored. Deleting a workspace permanently removes its documents and versions. Self-hosted deployments keep all data on your own infrastructure."],
        ["Contact", "Questions or data requests: use the contact form at pdftek.com/contact and choose \"Privacy & data request\"."],
      ]}
    />
  );
}
