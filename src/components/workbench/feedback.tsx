"use client";
import { useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import { Modal } from "../modal";
import { useToast } from "../toast";

export const FEEDBACK_ANSWERS = ["yes", "partly", "no"] as const;
export type FeedbackAnswer = (typeof FEEDBACK_ANSWERS)[number];

const CHOICES: { value: FeedbackAnswer; emoji: string; label: string }[] = [
  { value: "yes", emoji: "👍", label: "Yes" },
  { value: "partly", emoji: "🤔", label: "Partly" },
  { value: "no", emoji: "👎", label: "No" },
];

/** Optional feedback form opened from the workbench's Feedback button. */
export function FeedbackDialog({ wid, onClose }: { wid: string; onClose: () => void }) {
  const toast = useToast();
  const [answer, setAnswer] = useState<FeedbackAnswer | null>(null);
  const [lookingFor, setLookingFor] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!answer) return;
    setBusy(true);
    try {
      await api("/api/feedback", {
        method: "POST",
        json: { workspaceId: wid, answer, lookingFor, message, page: window.location.pathname },
      });
      toast("Thanks for your feedback!", "success");
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Send feedback"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!answer || busy} onClick={send}>
            {busy ? "Sending…" : "Send feedback"}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Did pdftek give you what you needed?</label>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }} role="radiogroup">
          {CHOICES.map((c) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={answer === c.value}
              className={`btn ${answer === c.value ? "btn-primary" : ""}`}
              onClick={() => setAnswer(c.value)}
            >
              <span aria-hidden>{c.emoji}</span> {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field mt-12">
        <label htmlFor="fb-looking">What were you looking for or trying to do? (optional)</label>
        <input
          id="fb-looking"
          className="input"
          value={lookingFor}
          maxLength={300}
          onChange={(e) => setLookingFor(e.target.value)}
          placeholder="e.g. Convert a scanned PDF to Excel"
        />
      </div>
      <div className="field mt-12">
        <label htmlFor="fb-message">Anything we could do better? (optional)</label>
        <textarea
          id="fb-message"
          className="textarea"
          rows={4}
          value={message}
          maxLength={3000}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Tell us what worked, what didn't, or a feature you'd like"
        />
      </div>
      <p className="small muted mt-12">Your feedback helps us decide what to improve next. We never look at your documents.</p>
    </Modal>
  );
}
