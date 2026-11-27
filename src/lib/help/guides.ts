/**
 * The Help Center: one guide per feature. Each guide has a short summary, numbered steps (each
 * with a screenshot from the real app) and a narrated video built from the same steps.
 *
 * `shot` names an image in /public/help/shots (made by scripts/help/capture.cjs from the real app);
 * the video for a guide is /public/help/video/<slug>.mp4 with captions in <slug>.vtt (made by
 * scripts/help/video.py). Change a step's text and re-run both scripts to keep them in step.
 */

export type HelpStep = { title: string; text: string; shot?: string };
export type HelpGuide = {
  slug: string;
  category: CategoryKey;
  title: string;
  summary: string;
  /** Who can use it (shown as a badge). */
  plan?: "Free" | "Pro" | "Pro or Day Pass" | "AI credits";
  steps: HelpStep[];
  tip?: string;
  related?: string[];
  /** Where to try it. */
  try?: { label: string; href: string };
};

export type CategoryKey = "start" | "documents" | "edit" | "sign" | "ai" | "clients" | "account";
export const CATEGORIES: { key: CategoryKey; title: string; blurb: string }[] = [
  { key: "start", title: "Getting started", blurb: "Your workbench, uploading, finding things and using pdftek on a phone." },
  { key: "documents", title: "Convert and organize", blurb: "Convert to and from PDF, merge, split, compress, scan and OCR." },
  { key: "edit", title: "Edit and protect", blurb: "Edit text and images, redact, watermark, passwords and versions." },
  { key: "sign", title: "Forms and signatures", blurb: "Fill forms, request signatures, templates, signing links and payments." },
  { key: "ai", title: "Ask AI", blurb: "Summaries, answers with page citations, data extraction, translation and automations." },
  { key: "clients", title: "Clients and requests", blurb: "Collect documents securely and give your clients their own portal." },
  { key: "account", title: "Team and account", blurb: "Members, plans and credits, integrations, language and dark mode." },
];

export const GUIDES: HelpGuide[] = [
  /* ---------------------------------------------------------------- getting started */
  {
    slug: "getting-started",
    category: "start",
    title: "Get started with pdftek",
    summary: "A quick tour of your workbench: the Home screen, your documents and where every tool lives.",
    plan: "Free",
    steps: [
      { title: "Start free", text: "Click Start free on pdftek.com. You get a private workspace straight away, no sign-up needed. Create a free account to keep your files and get more tasks a day.", shot: "site-home" },
      { title: "Your Home screen", text: "Home shows a greeting, six quick starts (Convert, Edit PDF, Sign or send, Fill a form, Scan and Ask AI) and your recent documents.", shot: "home" },
      { title: "The left menu", text: "Use the menu on the left for Documents, Clients, Signatures, Requests, Automations, All tools and Trash. Your plan and AI credits are at the bottom.", shot: "home-nav" },
      { title: "Open a document", text: "Click any document to open it. The page sits in the middle, every tool is listed on the left and Ask AI opens on the right.", shot: "doc" },
      { title: "Go back Home", text: "Click the arrow at the top left of a document to return to Home at any time.", shot: "doc-back" },
    ],
    related: ["upload-and-organize", "search", "phone"],
    try: { label: "Start free", href: "/go/start" },
  },
  {
    slug: "upload-and-organize",
    category: "start",
    title: "Upload and organize documents",
    summary: "Add files from your computer, your phone or the cloud, then rename, tag, filter and tidy them up.",
    plan: "Free",
    steps: [
      { title: "Add files", text: "Click New, then Upload files, or drag files anywhere onto the Home screen. PDFs, Word, Excel, PowerPoint, images and TIFF all work; other formats become PDFs as they upload.", shot: "new-menu" },
      { title: "From the cloud", text: "Choose From Google Drive, Dropbox or OneDrive in the New menu to open files straight from your cloud storage.", shot: "upload-cloud" },
      { title: "Filter and switch views", text: "Use the chips to show only PDFs, files from Office, scans or a tag. Switch between the grid and the list with the buttons on the right.", shot: "home-filters" },
      { title: "Rename, tag or download", text: "Click the three dots on a document for Rename, Tags, Download PDF or Move to trash. Tags appear as filter chips so you can group documents.", shot: "card-menu" },
      { title: "Restore from Trash", text: "Deleted something by mistake? Click Trash in the left menu and choose Restore.", shot: "trash" },
    ],
    related: ["search", "cloud-and-email-in"],
  },
  {
    slug: "search",
    category: "start",
    title: "Search everything",
    summary: "One search box finds documents by name, words inside any page, tools, or sends your question to the AI.",
    plan: "Free",
    steps: [
      { title: "Open search", text: "Click the search box at the top, or press the slash key on your keyboard from anywhere.", shot: "search-box" },
      { title: "Find a tool, a document or a page", text: "Type a few letters. Results show matching tools, document names and the exact pages where your words appear, highlighted.", shot: "search-results" },
      { title: "Jump to the page", text: "Click a result inside a document and it opens at that page with your words highlighted.", shot: "search-jump" },
      { title: "Ask instead", text: "The last result asks the AI your question, about the open document or your whole library.", shot: "search-ask" },
    ],
    related: ["ask-ai", "ocr"],
  },
  {
    slug: "phone",
    category: "start",
    title: "Use pdftek on your phone",
    summary: "Everything works on a phone: scan with the camera, open tools from a sheet and ask the AI full screen.",
    plan: "Free",
    steps: [
      { title: "Home on your phone", text: "Search sits at the top, with six quick starts and your recent documents below. The bar at the bottom has Home, Files, Scan, Clients and Account.", shot: "phone-home" },
      { title: "Scan", text: "Tap the big Scan button to photograph paper documents. pdftek finds the edges, straightens the page and saves a clean PDF.", shot: "phone-scan" },
      { title: "Tools for the open document", text: "Open a document and tap Tools. The sheet shows the most used tools; tap All tools for everything.", shot: "phone-tools" },
      { title: "Ask AI", text: "Tap Ask AI for answers about the document. Tap a page reference in an answer to jump straight to that page.", shot: "phone-ai" },
    ],
    related: ["scan", "ask-ai"],
  },

  /* ---------------------------------------------------------------- convert and organize */
  {
    slug: "convert-from-pdf",
    category: "documents",
    title: "Convert a PDF to Word, Excel, PowerPoint or images",
    summary: "Turn a PDF into an editable Office file or into images, keeping the layout.",
    plan: "Free",
    steps: [
      { title: "Open the PDF", text: "Open the document from Home, or click Convert on Home and choose your file.", shot: "home-convert" },
      { title: "Pick a format", text: "In All tools, under Convert, click To Word, To Excel, To PowerPoint, To JPG or To PNG.", shot: "tools-convert" },
      { title: "More formats", text: "Click More formats for WEBP, TIFF or plain text, or to convert only the page you are looking at.", shot: "more-formats" },
      { title: "Download", text: "The converted file downloads straight away. Your original PDF stays in your documents.", shot: "converted" },
    ],
    tip: "Tables become real spreadsheet cells in Excel, and text stays editable in Word.",
    related: ["convert-to-pdf", "statement-to-excel"],
  },
  {
    slug: "convert-to-pdf",
    category: "documents",
    title: "Convert Word, Excel, PowerPoint or images to PDF",
    summary: "Make a PDF from Office files, text files, TIFFs or a set of photos.",
    plan: "Free",
    steps: [
      { title: "Files to PDF", text: "In All tools, click Files → PDF, or choose Word, Excel or PowerPoint to PDF in the New menu.", shot: "topdf" },
      { title: "Add your files", text: "Pick one or more files. Each becomes a PDF in your documents, ready for every other tool.", shot: "topdf-modal" },
      { title: "Images to PDF", text: "Choose Images to PDF to combine photos into one document. Set the page size and the order before you create it.", shot: "images-pdf" },
    ],
    related: ["scan", "merge-and-split"],
  },
  {
    slug: "scan",
    category: "documents",
    title: "Scan paper documents",
    summary: "Use your phone or laptop camera to make a clean, straight, searchable PDF.",
    plan: "Free",
    steps: [
      { title: "Open the scanner", text: "Click Scan on Home, choose Scan with camera in the New menu, or tap the Scan button on your phone.", shot: "scan-open" },
      { title: "Capture pages", text: "Hold the page in view and take a photo. pdftek detects the edges and straightens it; add as many pages as you need.", shot: "scan-modal" },
      { title: "Save and make it searchable", text: "Save the scan as a PDF. Run OCR on it so you can search and copy its text.", shot: "scan-ocr" },
    ],
    related: ["ocr", "phone"],
  },
  {
    slug: "merge-and-split",
    category: "documents",
    title: "Merge and split PDFs",
    summary: "Combine documents into one, or break one into parts by page ranges.",
    plan: "Free",
    steps: [
      { title: "Merge", text: "Click Merge in All tools or in the New menu. Pick the documents, drag them into order and create the merged PDF.", shot: "merge" },
      { title: "Split", text: "Open a document and click Split. Type page ranges such as 1-3, 4-6 and each range becomes its own PDF.", shot: "split" },
      { title: "Extract pages", text: "Click Extract pages to copy just the pages you need into a new document.", shot: "extract-pages" },
    ],
    related: ["organize-pages", "compress"],
  },
  {
    slug: "organize-pages",
    category: "documents",
    title: "Reorder, rotate and delete pages",
    summary: "Rearrange pages visually and save the result as a new version.",
    plan: "Free",
    steps: [
      { title: "Open Organize pages", text: "Open the document and click Organize pages under Organize in All tools.", shot: "organize-tool" },
      { title: "Drag, rotate or remove", text: "Drag thumbnails to reorder them, rotate pages that are sideways and remove the ones you don't need.", shot: "organize" },
      { title: "Use the page thumbnails", text: "The thumbnails beside the page show every page. Click one to jump to it; the control at the bottom zooms and fits the page to the width.", shot: "thumbs" },
    ],
    related: ["merge-and-split", "versions-and-teamwork"],
  },
  {
    slug: "compress",
    category: "documents",
    title: "Compress a PDF",
    summary: "Make a large PDF smaller so it is easier to email and upload.",
    plan: "Free",
    steps: [
      { title: "Open Compress", text: "Open the document and click Compress under Organize in All tools.", shot: "compress-tool" },
      { title: "Create the smaller copy", text: "Choose Recommended for good quality at a much smaller size, or a stronger setting, and create the smaller copy.", shot: "compress" },
    ],
    related: ["merge-and-split"],
  },
  {
    slug: "ocr",
    category: "documents",
    title: "Make a scan searchable (OCR)",
    summary: "Recognize the text in scanned pages so you can search, copy and listen to it.",
    plan: "Free",
    steps: [
      { title: "Spot a scan", text: "Scanned documents show a Scan badge on Home, and a notice above the page when you open them.", shot: "scan-badge" },
      { title: "Run OCR", text: "Click Run OCR on the notice, or OCR in All tools. Pick every language in the document and click Start OCR.", shot: "ocr" },
      { title: "Search the text", text: "Text recognition runs privately in your browser. Afterwards the document's words appear in search and Read aloud.", shot: "search-results" },
    ],
    related: ["scan", "search"],
  },
  {
    slug: "compare",
    category: "documents",
    title: "Compare two documents",
    summary: "See every change between two documents, or between two versions of one.",
    plan: "Free",
    steps: [
      { title: "Open Compare", text: "Click Compare under Organize in All tools, or Compare in your account menu.", shot: "compare-tool" },
      { title: "Pick the two documents", text: "Choose the original and the new one. Additions and deletions are highlighted side by side.", shot: "compare" },
      { title: "Compare versions", text: "In Version history, click Compare next to an earlier version to see what changed.", shot: "versions" },
    ],
    related: ["versions-and-teamwork"],
  },

  /* ---------------------------------------------------------------- edit and protect */
  {
    slug: "edit-pdf",
    category: "edit",
    title: "Edit text and images in a PDF",
    summary: "Change existing text, type anywhere, add images, highlight, draw and white out.",
    plan: "Pro or Day Pass",
    steps: [
      { title: "Start editing", text: "Open the document and click Edit PDF on Home or in All tools. You hold the edit lock while you work, so teammates don't overwrite you.", shot: "edit-tool" },
      { title: "Change or add text", text: "Click any text to change it in a matching font, or choose Add text and click where you want to type.", shot: "edit" },
      { title: "Images, highlights and drawings", text: "Use Image, Highlight, Draw, Shape and Whiteout in the toolbar above the page. Colour and thickness appear when a tool is selected.", shot: "edit-toolbar" },
      { title: "Save a new version", text: "Click Save version. Your edit becomes a new version, and the earlier one stays in Version history.", shot: "edit-save" },
    ],
    tip: "Your changes are autosaved as a draft while you work.",
    related: ["redact", "versions-and-teamwork"],
  },
  {
    slug: "redact",
    category: "edit",
    title: "Redact sensitive information",
    summary: "Permanently remove names, numbers or anything else before you share a document.",
    plan: "Pro or Day Pass",
    steps: [
      { title: "Open Redact", text: "Click Redact under Edit or Protect in All tools.", shot: "redact-tool" },
      { title: "Mark what to remove", text: "Drag over text or areas to black them out. Each mark can be moved or deleted until you save.", shot: "redact" },
      { title: "Save", text: "Click Save version. Redacted content is removed from the file for good, not just hidden.", shot: "edit-save" },
    ],
    related: ["protect-and-unlock", "edit-pdf"],
  },
  {
    slug: "watermark-and-page-numbers",
    category: "edit",
    title: "Watermarks, page numbers and properties",
    summary: "Stamp DRAFT or CONFIDENTIAL, number your pages or set the title and author.",
    plan: "Free",
    steps: [
      { title: "Watermark", text: "Click Watermark under Edit in All tools, type the text, then choose its size, angle and opacity.", shot: "watermark" },
      { title: "Page numbers", text: "Click Page numbers to add Page 1 of 10, plain numbers or Bates numbers in the corner you choose.", shot: "page-numbers" },
      { title: "Properties", text: "Click Properties to set the document's title, author and subject.", shot: "metadata" },
    ],
    related: ["edit-pdf"],
  },
  {
    slug: "protect-and-unlock",
    category: "edit",
    title: "Add or remove a password",
    summary: "Encrypt a PDF with a password and permissions, or unlock one you can open.",
    plan: "Free",
    steps: [
      { title: "Add a password", text: "Click Add password under Protect in All tools. Set a password, and choose whether people may print, copy or edit.", shot: "protect" },
      { title: "Remove a password", text: "Click Remove password, upload the locked PDF and enter its password. An unlocked copy is added to your documents.", shot: "unlock" },
    ],
    tip: "pdftek uses AES-256 encryption, the strongest PDF standard.",
    related: ["redact"],
  },
  {
    slug: "versions-and-teamwork",
    category: "edit",
    title: "Versions, check out and hand off",
    summary: "Every change is a version you can restore. Lock a document while you work or pass it to a teammate.",
    plan: "Free",
    steps: [
      { title: "Version history", text: "Click the three dots at the top right of a document, then Version history. View, compare or restore any earlier version.", shot: "versions" },
      { title: "Check out", text: "Choose Check out to lock editing while you work. Teammates can still read and ask the AI; click Check in when you're done.", shot: "more-menu" },
      { title: "Hand off", text: "Choose Hand off to a teammate, pick a person and add a note. They're notified, and your lock moves with it.", shot: "handoff" },
      { title: "Share a link", text: "Click the share button to copy a link to the document for people in your workspace.", shot: "doc" },
    ],
    related: ["workspaces-and-members", "compare"],
  },
  {
    slug: "read-aloud",
    category: "edit",
    title: "Listen to a document",
    summary: "Have pdftek read a document to you, in 11 languages.",
    plan: "Pro or Day Pass",
    steps: [
      { title: "Start reading", text: "Open the document and click Read PDF under AI in All tools.", shot: "read-tool" },
      { title: "Control playback", text: "Pause, skip, change the speed or the voice. Reading starts from the page you are on.", shot: "read" },
    ],
    related: ["translate"],
  },

  /* ---------------------------------------------------------------- forms and signatures */
  {
    slug: "fill-forms",
    category: "sign",
    title: "Fill a PDF form with AI",
    summary: "pdftek finds every field and fills it from your profile. You check and finish the rest.",
    plan: "AI credits",
    steps: [
      { title: "Open Fill form", text: "Open the form and click Fill a form on Home or Fill form in All tools.", shot: "fill-tool" },
      { title: "Review the fields", text: "Every field is found, including on scanned forms, and filled from your saved profile. Click any field to change it.", shot: "fill" },
      { title: "Sign and save", text: "Add your signature, then save the filled form as a new version or download it.", shot: "fill-save" },
    ],
    related: ["request-signatures"],
  },
  {
    slug: "request-signatures",
    category: "sign",
    title: "Request signatures",
    summary: "Send a document for legally binding e-signature, with reminders and an audit trail.",
    plan: "Pro or Day Pass",
    steps: [
      { title: "Click Request signature", text: "Open the document and click Request signature at the top.", shot: "sign-button" },
      { title: "Add signers and fields", text: "Add each signer's name and email, then drag signature, date, initials and text fields onto the page for each person. Choose whether they sign in order.", shot: "send" },
      { title: "Send and track", text: "Click Send. Signers get an email with a secure link. Follow progress, send reminders or cancel in Signatures.", shot: "signatures" },
      { title: "The signed copy", text: "When everyone has signed, the signed PDF and its audit trail are saved as a new version and emailed to everyone.", shot: "signatures" },
    ],
    related: ["sign-templates-and-links", "fill-forms"],
  },
  {
    slug: "sign-templates-and-links",
    category: "sign",
    title: "Signing templates, bulk send, signing links and payments",
    summary: "Set a document up once and send it forever, to many people at once or with one public link.",
    plan: "Pro or Day Pass",
    steps: [
      { title: "Save a template", text: "Click Save as template under Fill & sign. Name the roles, for example Client, and place their fields once.", shot: "template" },
      { title: "Bulk send", text: "In Signatures, choose a template and Bulk send. Paste a list of names and emails; everyone gets their own copy.", shot: "signatures" },
      { title: "One link anyone can sign", text: "Create a Signing link to put on your website or in an email. Set an end date or a limit on signers if you need to.", shot: "signing-link" },
      { title: "Get paid when they sign", text: "Connect Stripe in Settings, Integrations, then add Collect a payment to a template or link. Signers pay as they sign.", shot: "integrations" },
    ],
    related: ["request-signatures", "cloud-and-email-in"],
  },
  {
    slug: "statement-to-excel",
    category: "sign",
    title: "Bank statements and invoices to Excel",
    summary: "Pull every transaction or line item into a clean spreadsheet, checked against the totals.",
    plan: "AI credits",
    steps: [
      { title: "Choose the converter", text: "Click Statement → Excel or Invoice → Excel under Convert in All tools.", shot: "to-excel-tool" },
      { title: "Check the results", text: "Transactions are listed with dates, descriptions and amounts and checked against the opening and closing balances.", shot: "to-excel" },
      { title: "Download", text: "Download the spreadsheet, ready for your accounting software.", shot: "to-excel" },
    ],
    related: ["extract-data", "convert-from-pdf"],
  },

  /* ---------------------------------------------------------------- AI */
  {
    slug: "ask-ai",
    category: "ai",
    title: "Ask AI about your documents",
    summary: "Get summaries and answers that cite the exact page they came from.",
    plan: "AI credits",
    steps: [
      { title: "Open Ask AI", text: "Open a document and click Ask AI at the top. The panel opens beside the page.", shot: "ai-open" },
      { title: "Summarize", text: "Click Summarize with key facts, or one of the suggested questions that fit your document.", shot: "ai-suggest" },
      { title: "Follow the citations", text: "Answers show page references. Click one to jump to that page, with the quoted words highlighted.", shot: "ai-answer" },
      { title: "Ask across your library", text: "Switch to Whole library to ask about all your documents at once, for example which contracts renew soon.", shot: "ai-library" },
    ],
    tip: "Each question uses AI credits. Pro includes a monthly allowance, and you can top up any time.",
    related: ["extract-data", "search"],
  },
  {
    slug: "extract-data",
    category: "ai",
    title: "Extract key terms, dates and tables",
    summary: "Pull structured data out of a document into a table you can download.",
    plan: "AI credits",
    steps: [
      { title: "Open Extract", text: "Click Ask AI, then the Extract tab, or Extract data under AI in All tools.", shot: "extract" },
      { title: "Choose what to pull", text: "Pick Key terms, Dates and deadlines, Risk flags, Obligations, Parties, Financial figures or Tables.", shot: "extract" },
      { title: "Use the results", text: "Results appear as tables with page references. Download them as a spreadsheet.", shot: "extract-result" },
    ],
    related: ["ask-ai", "automations", "playbook"],
  },
  {
    slug: "translate",
    category: "ai",
    title: "Translate a PDF",
    summary: "Translate a whole PDF into 35+ languages while keeping its layout.",
    plan: "AI credits",
    steps: [
      { title: "Open Translate", text: "Click Translate under AI in All tools.", shot: "translate-tool" },
      { title: "Pick the language", text: "Choose the language. You see roughly how many credits it will use before you start.", shot: "translate" },
      { title: "Open the translation", text: "The translated PDF is added to your documents and opens when it is ready.", shot: "doc" },
    ],
    related: ["read-aloud", "ask-ai"],
  },
  {
    slug: "automations",
    category: "ai",
    title: "Automations",
    summary: "Let pdftek do routine work: flag risks on upload, send a morning digest, remind you of renewals.",
    plan: "Pro",
    steps: [
      { title: "Open Automations", text: "Click Automations in the left menu on Home, or the Automate tab in Ask AI.", shot: "automate" },
      { title: "Start from a recipe", text: "Pick Risk review on upload, Morning digest, Renewal reminders or Signed → tracker, or build your own.", shot: "automate" },
      { title: "When and then", text: "Choose when it runs (a document is uploaded, a signature completes, a renewal is coming, or a schedule) and what happens next (extract, tag, notify or email).", shot: "automate-edit" },
    ],
    related: ["extract-data", "playbook"],
  },
  {
    slug: "playbook",
    category: "ai",
    title: "Your review playbook",
    summary: "Tell the AI your team's rules so it flags what matters to you.",
    plan: "Pro",
    steps: [
      { title: "Write your rules", text: "Open Settings, Review playbook, and write your positions, for example: liability cap at least 12 months of fees, no auto-renewal over one year.", shot: "playbook" },
      { title: "Check documents against it", text: "Risk flags in Extract, and Compare to playbook in Ask AI, check each document against these rules.", shot: "extract" },
    ],
    related: ["extract-data", "automations"],
  },

  /* ---------------------------------------------------------------- clients and requests */
  {
    slug: "document-requests",
    category: "clients",
    title: "Request documents with a secure link",
    summary: "Send a checklist and collect files without email attachments. Anyone can upload, no account needed.",
    plan: "Pro or Day Pass",
    steps: [
      { title: "New request", text: "Click Requests in the left menu, then New request. Start from a checklist such as ID verification or Rental application, or write your own.", shot: "requests" },
      { title: "Send it", text: "Add the person's email and a due date. They get a secure link; reminders go out automatically until everything arrives.", shot: "requests-new" },
      { title: "Collect the files", text: "Uploads land in your documents, named and tagged. You can see what's still missing at a glance.", shot: "requests" },
    ],
    related: ["clients-setup", "client-requests"],
  },
  {
    slug: "clients-setup",
    category: "clients",
    title: "Set up Clients and your portal",
    summary: "Give your clients a branded portal and keep everything about each client in one place.",
    plan: "Pro",
    steps: [
      { title: "Open Clients", text: "Click Clients in the left menu. The dashboard shows where every client stands for the fiscal year.", shot: "clients-dash" },
      { title: "Brand your portal", text: "In Firm settings, set your firm's name, colour and logo. Clients see them when they sign in.", shot: "firm-settings" },
      { title: "Add clients", text: "Click Add client, or Import to bring in a spreadsheet of names and emails. Pro includes up to 50 active clients.", shot: "client-add" },
      { title: "Invite them", text: "Open a client and click Invite to portal. They sign in with a code by email, with no password to remember.", shot: "client-profile" },
    ],
    related: ["client-requests", "client-portal"],
  },
  {
    slug: "client-requests",
    category: "clients",
    title: "Request documents from clients",
    summary: "Send checklists, track progress by stage, and let AI check every upload.",
    plan: "Pro",
    steps: [
      { title: "Request documents", text: "Open a client and click Request documents. Start from New client onboarding, ID verification, Employee onboarding, a tax checklist or your own list.", shot: "client-request" },
      { title: "Repeat automatically", text: "Choose to repeat the request every month, quarter or year, for example for monthly bookkeeping.", shot: "client-request" },
      { title: "Uploads are checked", text: "Each upload is checked against the item it was sent for, renamed and filed under the client and year. Problems are flagged for you and for the client.", shot: "client-profile" },
      { title: "Move clients along", text: "Click a stage to move the client from Waiting on client through to Completed. The dashboard shows who needs attention.", shot: "client-profile" },
    ],
    related: ["clients-setup", "client-portal"],
  },
  {
    slug: "client-portal",
    category: "clients",
    title: "What your clients see",
    summary: "Your clients sign in to your portal to upload documents, see what's needed and message you.",
    plan: "Pro",
    steps: [
      { title: "Passwordless sign-in", text: "Clients enter their email and type the code you send them, or click the one-time link in their invite.", shot: "portal-login" },
      { title: "Upload from any device", text: "Their checklist shows what's still needed. They can upload from a phone camera or computer, and mark items that don't apply.", shot: "portal-home" },
      { title: "Messages and shared files", text: "Clients message you securely and download files you share with them. Use Open client portal in Clients to see it as they do.", shot: "client-messages" },
    ],
    related: ["clients-setup", "client-requests"],
  },

  /* ---------------------------------------------------------------- team and account */
  {
    slug: "workspaces-and-members",
    category: "account",
    title: "Workspaces and teammates",
    summary: "Keep work separate in workspaces and invite your team with the right permissions.",
    plan: "Pro",
    steps: [
      { title: "Switch or add workspaces", text: "Click the workspace name at the top to switch, or choose New workspace. Each has its own documents, members and billing.", shot: "ws-menu" },
      { title: "Invite teammates", text: "Open Settings, Members. Enter an email and choose a role: Member or Admin. The person who created the workspace is its Owner.", shot: "members" },
      { title: "What roles can do", text: "Admins invite people, edit the playbook and release edit locks. Owners also manage billing.", shot: "members" },
    ],
    related: ["versions-and-teamwork", "plans-and-credits"],
  },
  {
    slug: "plans-and-credits",
    category: "account",
    title: "Plans, Day Pass and AI credits",
    summary: "Free tools stay free. Upgrade for editing, e-signatures, Clients and more AI.",
    plan: "Free",
    steps: [
      { title: "See your plan", text: "Your plan and AI credits are at the bottom of the left menu and in your account menu.", shot: "home-nav" },
      { title: "Upgrade or top up", text: "Open Settings, Plan & billing to start a free Pro trial, buy a Day Pass for 24 hours, or top up AI credits.", shot: "billing" },
      { title: "Manage billing", text: "Change or cancel your plan and download invoices from the same page.", shot: "billing" },
    ],
    related: ["workspaces-and-members"],
    try: { label: "See plans", href: "/pricing" },
  },
  {
    slug: "cloud-and-email-in",
    category: "account",
    title: "Cloud storage, email in and Stripe",
    summary: "Connect Google Drive, Dropbox or OneDrive, email documents to pdftek, and get paid with Stripe.",
    plan: "Pro or Day Pass",
    steps: [
      { title: "Open Integrations", text: "Open Settings, Integrations.", shot: "integrations" },
      { title: "Cloud storage", text: "Connect Google Drive, Dropbox or OneDrive to open files from them and save results back with Save to cloud.", shot: "integrations" },
      { title: "Email to pdftek", text: "Turn on your workspace's email address. Attachments sent to it are added to your documents, and you choose who can send.", shot: "integrations" },
      { title: "Payments with Stripe", text: "Connect Stripe to collect payments when people sign.", shot: "integrations" },
    ],
    related: ["upload-and-organize", "sign-templates-and-links"],
  },
  {
    slug: "language-and-dark-mode",
    category: "account",
    title: "Language, dark mode and your profile",
    summary: "Use pdftek in 26 languages, switch to dark mode and keep your profile up to date.",
    plan: "Free",
    steps: [
      { title: "Account menu", text: "Click your initials at the top right for Profile, Plan & billing, the language, Dark mode, feedback and Sign out.", shot: "account-menu" },
      { title: "Change the language", text: "Click the language name and pick from 26 languages. The whole site and app switch.", shot: "language" },
      { title: "Dark mode", text: "Choose Dark mode for a darker workbench; choose Light mode to switch back.", shot: "dark" },
      { title: "Your profile", text: "In Settings, Profile, update your name and password.", shot: "profile" },
    ],
    related: ["getting-started"],
  },
];

export const guideBySlug = (slug: string) => GUIDES.find((g) => g.slug === slug);

/** Everything a guide says, in order (for search and the narration). */
export function guideText(g: HelpGuide) {
  return [g.title, g.summary, ...g.steps.flatMap((s) => [s.title, s.text]), g.tip ?? ""].join(" ");
}
