"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errMsg, timeAgo } from "@/lib/client/api";
import { I } from "../icons";
import { useToast } from "../toast";
import { PageHead } from "./shell";
import { Avatar, Empty } from "./ui";
import { Thread } from "./profile";

type Conv = { clientId: string; name: string; last: { body: string; author: string; createdAt: number; internal: boolean } | null; unread: number };
type Msg = Parameters<typeof Thread>[0]["messages"][number];

/** Every client conversation in one place, newest first. */
export function Inbox({ wid }: { wid: string }) {
  const toast = useToast();
  const [list, setList] = useState<Conv[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const load = useCallback(() => {
    api<{ conversations: Conv[] }>(`/api/workspaces/${wid}/clients/messages`)
      .then((r) => {
        setList(r.conversations);
        setSel((s) => s ?? r.conversations[0]?.clientId ?? null);
      })
      .catch((e) => toast(errMsg(e), "error"));
  }, [wid, toast]);
  useEffect(load, [load]);
  const open = useCallback(() => {
    if (!sel) return;
    api<{ messages: Msg[] }>(`/api/workspaces/${wid}/clients/${sel}`).then((d) => setMsgs(d.messages)).catch(() => {});
    void api(`/api/workspaces/${wid}/clients/${sel}`, { method: "POST", json: { action: "read" } }).then(() => setList((l) => l?.map((c) => (c.clientId === sel ? { ...c, unread: 0 } : c)) ?? l));
  }, [wid, sel]);
  useEffect(open, [open]);
  const cur = list?.find((c) => c.clientId === sel);
  return (
    <div className="fa-page">
      <PageHead title="Messages" sub="Secure conversations with your clients. They read and reply in their portal." />
      {!list ? (
        <div className="fa-loading"><span className="spinner spinner-lg" /></div>
      ) : !list.length ? (
        <div className="fa-card">
          <Empty icon={<I.chat size={26} />} title="No conversations yet" body="Open a client and send them a message, or wait for one from the portal." />
        </div>
      ) : (
        <div className={`fa-inbox ${sel ? "has-sel" : ""}`}>
          <ul className="fa-card fa-convs">
            {list.map((c) => (
              <li key={c.clientId}>
                <button className={c.clientId === sel ? "on" : ""} onClick={() => setSel(c.clientId)}>
                  <Avatar name={c.name} size={36} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="row between">
                      <b className="ellipsis">{c.name}</b>
                      {c.last && <span className="small faint">{timeAgo(c.last.createdAt)}</span>}
                    </span>
                    <span className={`small ellipsis ${c.unread ? "" : "muted"}`} style={{ display: "block", fontWeight: c.unread ? 600 : 400 }}>
                      {c.last ? `${c.last.author === "firm" ? (c.last.internal ? "Note: " : "You: ") : ""}${c.last.body}` : "No messages yet"}
                    </span>
                  </span>
                  {c.unread > 0 && <span className="fa-count hot">{c.unread}</span>}
                </button>
              </li>
            ))}
          </ul>
          {cur && (
            <div className="col gap-8" style={{ minWidth: 0 }}>
              <div className="row between">
                <button className="btn btn-sm btn-ghost fa-inbox-back" onClick={() => setSel(null)}>
                  <I.left size={14} /> All
                </button>
                <Link href={`/app/${wid}/clients/${cur.clientId}`} className="small">Open {cur.name}’s profile →</Link>
              </div>
              <Thread
                wid={wid}
                cid={cur.clientId}
                messages={msgs}
                clientName={cur.name}
                onSent={() => {
                  open();
                  load();
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
