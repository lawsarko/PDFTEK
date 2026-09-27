import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null | undefined;

function getTransport(): Transporter | null {
  if (transporter !== undefined) return transporter;
  transporter = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
  return transporter;
}

export function appUrl(pathname = ""): string {
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return base + pathname;
}

export function mailConfigured() {
  return Boolean(process.env.SMTP_URL);
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function sendMail(opts: {
  to: string;
  subject: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
}): Promise<{ delivered: boolean }> {
  const text = [opts.heading, "", ...opts.paragraphs, "", opts.cta ? `${opts.cta.label}: ${opts.cta.url}` : ""].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f3f0e8;font-family:Helvetica,Arial,sans-serif;color:#2b2a26">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;padding:32px">
<tr><td style="font-weight:700;font-size:15px;letter-spacing:.02em;color:#10151c">pdftek</td></tr>
<tr><td style="padding-top:20px;font-size:20px;font-weight:600;color:#10151c">${escape(opts.heading)}</td></tr>
${opts.paragraphs.map((p) => `<tr><td style="padding-top:12px;font-size:14px;line-height:1.6">${escape(p)}</td></tr>`).join("")}
${opts.cta ? `<tr><td style="padding-top:24px"><a href="${escape(opts.cta.url)}" style="background:#d98e2b;color:#1a1206;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:7px;display:inline-block">${escape(opts.cta.label)}</a></td></tr>` : ""}
<tr><td style="padding-top:28px;font-size:12px;color:#8a8471">Sent by pdftek on behalf of your team.</td></tr>
</table></td></tr></table></body></html>`;

  const t = getTransport();
  if (!t) {
    console.info(`[pdftek mail] (SMTP not configured) to=${opts.to} subject="${opts.subject}"\n${text}`);
    return { delivered: false };
  }
  try {
    await t.sendMail({ from: process.env.MAIL_FROM || "pdftek <no-reply@pdftek.app>", to: opts.to, subject: opts.subject, text, html });
    return { delivered: true };
  } catch (err) {
    console.error("[pdftek mail] send failed", err);
    return { delivered: false };
  }
}
