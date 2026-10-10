import Link from "next/link";
import { redirect } from "next/navigation";
import { get } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { Logo, Wordmark } from "@/components/icons";
import { AcceptInvite } from "./accept";

export const dynamic = "force-dynamic";

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = get<{ email: string; workspace_name: string; inviter: string; accepted_at: number | null }>(
    `SELECT i.email, i.accepted_at, w.name AS workspace_name, u.name AS inviter FROM invites i
       JOIN workspaces w ON w.id = i.workspace_id JOIN users u ON u.id = i.invited_by WHERE i.token = ?`,
    token,
  );
  const user = await currentUser();
  if (inv && !inv.accepted_at && !user) {
    const exists = get("SELECT 1 FROM users WHERE email = ?", inv.email);
    redirect(exists ? `/login?invite=${token}` : `/signup?invite=${token}`);
  }
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Link href="/" className="brand" style={{ marginBottom: 22 }}>
          <Logo /> <Wordmark />
        </Link>
        {!inv || inv.accepted_at ? (
          <>
            <h1 style={{ fontSize: 22 }}>Invitation unavailable</h1>
            <p className="muted">This invitation was already used or has been revoked. Ask your teammate to send a new one.</p>
            <Link className="btn btn-primary mt-12" href="/app">Go to pdftek</Link>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22 }}>Join {inv.workspace_name}</h1>
            <p className="muted">
              {inv.inviter} invited <b>{inv.email}</b>. You’re signed in as <b>{user!.email}</b>.
            </p>
            <AcceptInvite token={token} />
          </>
        )}
      </div>
    </div>
  );
}
