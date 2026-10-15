"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, errMsg } from "@/lib/client/api";
import { I } from "@/components/icons";
import { CONTACT_TOPICS, type ContactTopic } from "@/lib/contact";
import { useT } from "@/components/i18n";

export function ContactForm({ me }: { me: { name: string; email: string } | null }) {
  const params = useSearchParams();
  const t = useT();
  const asked = (params.get("topic") ?? "").toLowerCase();
  const [form, setForm] = useState({
    name: me?.name ?? "",
    email: me?.email ?? "",
    // Links like /contact?topic=billing preselect the topic.
    topic: ((asked && CONTACT_TOPICS.find((t) => t.toLowerCase().startsWith(asked))) || CONTACT_TOPICS[0]) as ContactTopic,
    message: "",
    website: "",
  });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/contact", { method: "POST", json: form });
      setSent(true);
    } catch (err) {
      setError(errMsg(err));
    }
    setBusy(false);
  };

  if (sent) {
    return (
      <div className="auth-card contact-card" role="status">
        <h2 style={{ fontSize: 20, margin: 0 }}>
          <I.check size={18} /> {t("Message sent")}
        </h2>
        <p className="small muted" style={{ lineHeight: 1.6 }}>
          {t("Thanks, {name}. We'll reply to {email}. If you don't see it, check your spam folder.", { name: form.name.split(" ")[0], email: form.email })}
        </p>
        <button className="btn" onClick={() => { setSent(false); setForm({ ...form, message: "" }); }}>
          {t("Send another message")}
        </button>
      </div>
    );
  }

  return (
    <form className="auth-card contact-card col gap-12" onSubmit={submit}>
      <div className="contact-row">
        <div className="field">
          <label htmlFor="c-name">{t("Name")}</label>
          <input id="c-name" className="input" autoComplete="name" required maxLength={120} value={form.name} onChange={set("name")} />
        </div>
        <div className="field">
          <label htmlFor="c-email">{t("Email")}</label>
          <input id="c-email" className="input" type="email" autoComplete="email" required maxLength={200} value={form.email} onChange={set("email")} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="c-topic">{t("What is it about?")}</label>
        <select id="c-topic" className="select" value={form.topic} onChange={set("topic")}>
          {CONTACT_TOPICS.map((topic) => (
            <option key={topic} value={topic}>
              {t(topic)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="c-message">{t("Message")}</label>
        <textarea id="c-message" className="input" rows={7} required minLength={10} maxLength={5000} value={form.message} onChange={set("message")} placeholder={t("How can we help?")} style={{ resize: "vertical", minHeight: 140 }} />
      </div>
      {/* Hidden from people; bots fill it in. */}
      <div aria-hidden="true" style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor="c-website">Website</label>
        <input id="c-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
      </div>
      {error && <div className="error-text">{error}</div>}
      <button className="btn btn-primary btn-lg" disabled={busy}>
        {busy && <span className="spinner" />} {t("Send message")}
      </button>
    </form>
  );
}
