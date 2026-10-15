import Link from "next/link";
import { Logo } from "@/components/icons";
import { getI18n } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: "center" }}>
        <Logo size={36} />
        <h1 style={{ fontSize: 22, marginTop: 12 }}>{t("Page not found")}</h1>
        <p className="muted">{t("The page you're looking for doesn't exist, or you don't have access to it.")}</p>
        <Link className="btn btn-primary mt-12" href="/app">
          {t("Go to your workbench")}
        </Link>
      </div>
    </div>
  );
}
