import { z } from "zod";
import { get, insert, run } from "@/lib/db";
import { id, now, token } from "@/lib/ids";
import { body, json, route, conflict } from "@/lib/http";
import { requireMember } from "@/lib/auth";
import { appUrl, sendMail } from "@/lib/mail";

type P = { params: Promise<{ wid: string }> };

const Input = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["admin", "member"]).default("member") });

export const POST = route<P>(async (req, { params }) => {
  const { wid } = await params;
  const ctx = await requireMember(wid, "admin");
  const input = await body(req, Input);
  const existing = get("SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.email = ?", wid, input.email);
  if (existing) throw conflict("That person is already a member.");
  const t = token();
  insert("invites", { id: id("inv_"), workspace_id: wid, email: input.email, role: input.role, token: t, invited_by: ctx.user.id, created_at: now() });
  const link = appUrl(`/invite/${t}`);
  const { delivered } = await sendMail({
    to: input.email,
    subject: `${ctx.user.name} invited you to ${ctx.workspace.name} on pdftek`,
    heading: `Join ${ctx.workspace.name} on pdftek`,
    paragraphs: [`${ctx.user.name} invited you to collaborate on documents in the ${ctx.workspace.name} workspace.`],
    cta: { label: "Accept invitation", url: link },
  });
  return json({ link, delivered });
});

export const DELETE = route<P>(async (req, { params }) => {
  const { wid } = await params;
  await requireMember(wid, "admin");
  const inviteId = new URL(req.url).searchParams.get("id");
  run("DELETE FROM invites WHERE id = ? AND workspace_id = ?", inviteId, wid);
  return json({ ok: true });
});
