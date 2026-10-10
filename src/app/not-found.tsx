import Link from "next/link";
import { Logo } from "@/components/icons";

export default function NotFound() {
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: "center" }}>
        <Logo size={36} />
        <h1 style={{ fontSize: 22, marginTop: 12 }}>Page not found</h1>
        <p className="muted">The page you&apos;re looking for doesn&apos;t exist, or you don&apos;t have access to it.</p>
        <Link className="btn btn-primary mt-12" href="/app">
          Go to your workbench
        </Link>
      </div>
    </div>
  );
}
