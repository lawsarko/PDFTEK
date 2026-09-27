"use client";
import Link from "next/link";
import { useState } from "react";
import { api, errMsg } from "@/lib/client/api";
import { Modal } from "../modal";
import { useToast } from "../toast";
import { useWB } from "./context";

export function ProModal({ feature, onClose }: { feature: string; onClose: () => void }) {
  const { wid, info, reloadInfo } = useWB();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const canTrial = info.role === "owner" && !info.workspace.trialEndsAt;
  const start = async () => {
    setBusy(true);
    try {
      await api(`/api/workspaces/${wid}/billing`, { method: "POST", json: { action: "trial" } });
      await reloadInfo();
      toast("Pro trial started — enjoy 14 days of everything", "success");
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
      setBusy(false);
    }
  };
  return (
    <Modal title={<span className="row">{feature} <span className="pro-tag">PRO</span></span>} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        {feature} is part of pdftek Pro, along with everything your team needs to run document workflows end-to-end:
      </p>
      <ul className="mk-list" style={{ marginTop: 8 }}>
        <li>Click-to-edit text, images, highlights and true redaction</li>
        <li>E-signatures with audit certificates</li>
        <li>Document requests with secure upload links</li>
        <li>Automations: digests, risk flags, renewal reminders, webhooks</li>
        <li>Full version history on every document</li>
      </ul>
      <div className="row mt-24" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onClose}>Maybe later</button>
        {canTrial ? (
          <button className="btn btn-primary" onClick={start} disabled={busy}>
            Start free 14-day trial
          </button>
        ) : (
          <Link className="btn btn-primary" href={`/app/${wid}/settings?tab=billing`}>
            {info.role === "owner" ? "Upgrade workspace" : "Ask an owner to upgrade"}
          </Link>
        )}
      </div>
    </Modal>
  );
}
