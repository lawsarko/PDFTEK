import { z } from "zod";
import { run } from "@/lib/db";
import { body, clientIp, json, route } from "@/lib/http";
import { rateLimit, requireMember } from "@/lib/auth";
import { tierOf } from "@/lib/billing";
import { getLocale } from "@/lib/i18n/server";
import { sendMail } from "@/lib/mail";
import { id, now } from "@/lib/ids";

const ANSWERS = ["yes", "partly", "no"] as const;
const LABEL: Record<(typeof ANSWERS)[number], string> = { yes: "👍 Yes", partly: "🤔 Partly", no: "👎 No" };

const schema = z.object({
  workspaceId: z.string().min(1).max(64),
  answer: z.enum(ANSWERS),
  lookingFor: z.string().trim().max(300).optional().default(""),
  message: z.string().trim().max(3000).optional().default(""),
  page: z.string().max(300).optional().default(""),
});

/** Where feedback goes: CONTACT_EMAIL, else the first admin email (same as the contact form). */
function inbox() {
  return process.env.CONTACT_EMAIL?.trim() || (process.env.ADMIN_EMAILS ?? "").split(",")[0]?.trim() || "";
}

/** Optional "did pdftek give you what you needed?" feedback from the workbench. */
export const POST = route(async (req) => {
  rateLimit(`feedback:${clientIp(req)}`, 10, 3600_000);
  const f = await body(req, schema);
  const ctx = await requireMember(f.workspaceId);
  rateLimit(`feedback:${ctx.user.id}`, 10, 86_400_000);

  const tier = tierOf(ctx);
  const locale = await getLocale();
  const page = f.page.startsWith("/") ? f.page : "";
  const fbId = id("fb_");
  run(
    "INSERT INTO feedback (id, user_id, workspace_id, answer, looking_for, message, tier, locale, page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    fbId,
    ctx.user.id,
    ctx.workspace.id,
    f.answer,
    f.lookingFor,
    f.message,
    tier,
    locale,
    page,
    now(),
  );

  const to = inbox();
  if (to) {
    const who = ctx.user.is_guest ? "Guest (not signed up)" : `${ctx.user.name} <${ctx.user.email}>`;
    const sent = await sendMail({
      to,
      replyTo: ctx.user.is_guest ? undefined : ctx.user.email,
      subject: `[pdftek feedback] ${LABEL[f.answer]}${f.lookingFor ? `: ${f.lookingFor.slice(0, 60)}` : ""}`,
      heading: `Feedback: ${LABEL[f.answer]}`,
      paragraphs: [
        `Did pdftek give them what they needed? ${LABEL[f.answer]}`,
        `What they were looking for: ${f.lookingFor || "(not answered)"}`,
        `Anything we could do better: ${f.message || "(not answered)"}`,
        `From: ${who}. Plan: ${tier}. Language: ${locale}. Page: ${page || "unknown"}.`,
      ],
      footer: "Sent from the Feedback button in the pdftek workbench.",
    });
    if (sent.delivered) run("UPDATE feedback SET emailed = 1 WHERE id = ?", fbId);
  } else console.warn("[pdftek] feedback saved but CONTACT_EMAIL is not set", fbId);
  return json({ ok: true });
});
