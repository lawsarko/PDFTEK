"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, errMsg } from "@/lib/client/api";
import { I } from "@/components/icons";
import { CONTACT_TOPICS, type ContactTopic } from "@/lib/contact";

export function ContactForm({ me }: { me: { name: string; email: string } | null }) {
  const params = useSearchParams();
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
          <I.check size={18} /> Message sent
        </h2>
        <p className="small muted" style={{ lineHeight: 1.6 }}>
          Thanks, {form.name.split(" ")[0]}. We&apos;ll reply to <b>{form.email}</b>. If you don&apos;t see it, check your spam folder.
        </p>
        <button className="btn" onClick={() => { setSent(false); setForm({ ...form, message: "" }); }}>
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form className="auth-card contact-card col gap-12" onSubmit={submit}>
      <div className="contact-row">
        <div className="field">
          <label htmlFor="c-name">Name</label>
          <input id="c-name" className="input" autoComplete="name" required maxLength={120} value={form.name} onChange={set("name")} />
        </div>
        <div className="field">
          <label htmlFor="c-email">Email</label>
          <input id="c-email" className="input" type="email" autoComplete="email" required maxLength={200} value={form.email} onChange={set("email")} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="c-topic">What is it about?</label>
        <select id="c-topic" className="select" value={form.topic} onChange={set("topic")}>
          {CONTACT_TOPICS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="c-message">Message</label>
        <textarea id="c-message" className="input" rows={7} required minLength={10} maxLength={5000} value={form.message} onChange={set("message")} placeholder="How can we help?" style={{ resize: "vertical", minHeight: 140 }} />
      </div>
      {/* Hidden from people; bots fill it in. */}
      <div aria-hidden="true" style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor="c-website">Website</label>
        <input id="c-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
      </div>
      {error && <div className="error-text">{error}</div>}
      <button className="btn btn-primary btn-lg" disabled={busy}>
        {busy && <span className="spinner" />} Send message
      </button>
    </form>
  );
}
