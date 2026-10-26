import { z } from "zod";
import { run } from "@/lib/db";
import { body, clientIp, json, route } from "@/lib/http";
import { currentUser, rateLimit } from "@/lib/auth";
import { sendMail } from "@/lib/mail";
import { id, now } from "@/lib/ids";
import { CONTACT_TOPICS } from "@/lib/contact";

const schema = z.object({
  name: z.string().trim().min(1, "Please enter your name.").max(120),
  email: z.string().trim().toLowerCase().email("Please enter a valid email address.").max(200),
  topic: z.enum(CONTACT_TOPICS),
  message: z.string().trim().min(10, "Please write a little more so we can help.").max(5000),
  /** Honeypot: hidden from people, filled in by bots. */
  website: z.string().max(500).optional(),
});

/** Where contact messages go: CONTACT_EMAIL, else the first admin email. */
function inbox() {
  return process.env.CONTACT_EMAIL?.trim() || (process.env.ADMIN_EMAILS ?? "").split(",")[0]?.trim() || "";
}

export const POST = route(async (req) => {
  const ip = clientIp(req);
  rateLimit(`contact:${ip}`, 5, 3600_000);
  const msg = await body(req, schema);
  // Bots get the same answer as people, so they don't learn to skip the trap.
  if (msg.website) return json({ ok: true });
  rateLimit(`contact:${msg.email}`, 5, 86_400_000);

  const user = await currentUser();
  const msgId = id("msg_");
  run(
    "INSERT INTO contact_messages (id, name, email, topic, message, user_id, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    msgId,
    msg.name,
    msg.email,
    msg.topic,
    msg.message,
    user && !user.is_guest ? user.id : null,
    ip,
    now(),
  );

  const to = inbox();
  if (to) {
    const account = user && !user.is_guest ? `Signed in as ${user.email}.` : "Not signed in.";
    const sent = await sendMail({
      to,
      replyTo: `${msg.name.replace(/[<>"\r\n]/g, "")} <${msg.email}>`,
      subject: `[pdftek] ${msg.topic}: ${msg.name}`,
      heading: `${msg.topic} from ${msg.name}`,
      paragraphs: [`From: ${msg.name} <${msg.email}>. ${account}`, ...msg.message.split(/\n\s*\n/)],
      footer: "Sent from the contact form on pdftek. Reply to this email to answer them directly.",
    });
    if (sent.delivered) run("UPDATE contact_messages SET emailed = 1 WHERE id = ?", msgId);
  } else console.warn("[pdftek] contact message saved but CONTACT_EMAIL is not set", msgId);
  return json({ ok: true });
});
