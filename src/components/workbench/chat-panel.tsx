"use client";
import { notifyPaywall, notifyUsage } from "../paywall";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg, timeAgo } from "@/lib/client/api";
import type { ChatMessage, Citation, SourceRef } from "@/lib/client/types";
import { I } from "../icons";
import { useToast } from "../toast";
import { useWB } from "./context";
import { AiUnavailable, RichText } from "./assistant";

const CONTRACT = ["Summarize this document", "What are the key dates and deadlines?", "What's our exit path if we just want out?", "Compare to playbook", "List each party's obligations"];
const INVOICE = ["Summarize this document", "What is the total, and when is it due?", "List the line items with amounts", "Who is the vendor, and how do we pay?"];
const STATEMENT = ["Summarize this document", "What are the opening and closing balances?", "List the largest transactions", "Are there any fees or unusual charges?"];
const TAX = ["Summarize this document", "What are the key amounts on this form?", "Which tax year and taxpayer is this for?", "Is anything missing or unsigned?"];
const RESUME = ["Summarize this document", "List the work history with dates", "What are the key skills?"];
const GENERAL = ["Summarize this document", "What are the key dates and deadlines?", "List the names, amounts and dates", "What needs action, and by whom?"];

/** Suggested questions that fit the kind of document (from its name and tags). */
function docSuggestions(name: string, tags: string[]) {
  const s = `${name} ${tags.join(" ")}`.toLowerCase();
  if (/invoice|receipt|bill\b|quote|estimate|purchase order|\bpo\b/.test(s)) return INVOICE;
  if (/statement|bank|account summary|transactions/.test(s)) return STATEMENT;
  if (/\b(w-?2|w-?9|1099|1040|1098|k-?1|tax|irs)\b/.test(s)) return TAX;
  if (/resume|résumé|\bcv\b|curriculum/.test(s)) return RESUME;
  if (/contract|agreement|lease|nda|terms|addendum|amendment|offer|policy|msa|sow/.test(s)) return CONTRACT;
  return GENERAL;
}
const KB_SUGGESTIONS = ["Which contracts renew in the next 90 days?", "Where do we cap liability, and at what amount?", "Summarize everything we have from this vendor"];

export function ChatPanel() {
  const { active, wid, info, jump, openDoc } = useWB();
  const toast = useToast();
  const [scope, setScopeState] = useState<"doc" | "kb">(active ? "doc" : "kb");
  const picked = useRef(false);
  const setScope = (s: "doc" | "kb") => {
    picked.current = true;
    setScopeState(s);
  };
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  /** A question asked while the panel was still opening; sent once the conversation loads. */
  const queued = useRef<string | null>(null);
  const endpoint = scope === "doc" && active ? `/api/documents/${active.id}/chat` : `/api/workspaces/${wid}/chat`;

  useEffect(() => {
    if (!active && scope === "doc") setScopeState("kb");
    else if (active && scope === "kb" && !picked.current) setScopeState("doc");
  }, [active, scope]);

  useEffect(() => {
    setMessages(null);
    api<{ messages: ChatMessage[] }>(endpoint)
      .then((r) => setMessages(r.messages))
      .catch(() => setMessages([]));
  }, [endpoint]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      setInput("");
      setBusy(true);
      const userMsg: ChatMessage = { id: `u${Date.now()}`, role: "user", segments: [{ text: q, citations: [] }], refs: [], createdAt: Date.now() };
      const aiMsg: ChatMessage = { id: `a${Date.now()}`, role: "assistant", segments: [], refs: [], createdAt: Date.now(), pending: true };
      setMessages((m) => [...(m ?? []), userMsg, aiMsg]);
      const patch = (fn: (m: ChatMessage) => ChatMessage) => setMessages((list) => (list ? list.map((x) => (x.id === aiMsg.id ? fn(x) : x)) : list));
      try {
        const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 402) notifyPaywall({ code: data.code ?? "credits_required", message: data.error });
          throw new Error(data.error ?? "The assistant is unavailable.");
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            const ev = JSON.parse(line);
            if (ev.type === "refs") patch((m) => ({ ...m, refs: ev.refs }));
            else if (ev.type === "segment") patch((m) => ({ ...m, segments: [...m.segments, { text: "", citations: [] }] }));
            else if (ev.type === "text")
              patch((m) => {
                const segs = m.segments.length ? [...m.segments] : [{ text: "", citations: [] }];
                segs[segs.length - 1] = { ...segs[segs.length - 1], text: segs[segs.length - 1].text + ev.text };
                return { ...m, segments: segs };
              });
            else if (ev.type === "citation")
              patch((m) => {
                const segs = m.segments.length ? [...m.segments] : [{ text: "", citations: [] }];
                const last = segs[segs.length - 1];
                segs[segs.length - 1] = { ...last, citations: [...last.citations, ev.citation] };
                return { ...m, segments: segs };
              });
            else if (ev.type === "refusal") patch((m) => ({ ...m, segments: [...m.segments, { text: ev.message, citations: [] }] }));
            else if (ev.type === "error") patch((m) => ({ ...m, error: ev.error }));
            else if (ev.type === "done") {
              patch((m) => ({ ...m, id: ev.id }));
              notifyUsage(); // the answer used credits
            }
          }
        }
        patch((m) => ({ ...m, pending: false }));
      } catch (e) {
        patch((m) => ({ ...m, pending: false, error: errMsg(e) }));
      } finally {
        setBusy(false);
      }
    },
    [busy, endpoint],
  );

  useEffect(() => {
    if (messages === null || !queued.current) return;
    const q = queued.current;
    queued.current = null;
    void send(q);
  }, [messages, send]);

  // The toolbar's AI buttons ("Summarize", "Ask a question") hand the chat a question.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const { question, submit } = (e as CustomEvent<{ question: string; submit?: boolean }>).detail;
      if (active) setScope("doc");
      if (submit && messages !== null) void send(question);
      else if (submit && question) queued.current = question;
      else {
        setInput(question);
        setTimeout(() => document.querySelector<HTMLTextAreaElement>(".assistant textarea")?.focus(), 50);
      }
    };
    window.addEventListener("pdftek:ask", onAsk);
    return () => window.removeEventListener("pdftek:ask", onAsk);
  }, [active, messages, send]);

  const clear = async () => {
    await api(endpoint, { method: "DELETE" }).catch((e) => toast(errMsg(e), "error"));
    setMessages([]);
  };

  const openCitation = (c: Citation, refs: SourceRef[]) => {
    if (scope === "doc") {
      jump(c.startPage ?? 1, c.citedText);
    } else {
      const ref = refs[c.documentIndex];
      if (ref?.documentId) openDoc(ref.documentId, { page: ref.page ?? 1, text: c.citedText });
    }
  };

  const citeLabel = (c: Citation, refs: SourceRef[]) => {
    if (scope === "doc") return c.startPage ? `p.${c.startPage}${c.endPage && c.endPage - 1 > c.startPage ? `–${c.endPage - 1}` : ""}` : "source";
    const ref = refs[c.documentIndex];
    return ref ? `${ref.documentName.replace(/\.pdf$/i, "").slice(0, 22)} · p.${ref.page}` : "source";
  };

  return (
    <>
      <div className="panel-body">
        <div className="row gap-4">
          <button className={`chip ${scope === "doc" ? "active" : ""}`} disabled={!active} onClick={() => setScope("doc")}>
            <I.file size={11} /> This document
          </button>
          <button className={`chip ${scope === "kb" ? "active" : ""}`} onClick={() => setScope("kb")}>
            <I.layers size={11} /> Whole library
          </button>
          <span className="grow" />
          {!!messages?.length && (
            <button className="btn btn-ghost btn-sm" onClick={clear}>
              Clear
            </button>
          )}
        </div>
        {!info.capabilities.ai && <AiUnavailable />}
        {messages === null && <span className="spinner" />}
        {messages?.length === 0 && (
          <div className="msg msg-ai muted">
            {scope === "doc" && active
              ? `I've indexed ${active.name}. Ask anything about its terms — every answer links back to the exact page.`
              : info.stats.docs === 0
                ? `Upload documents to ${info.workspace.name}, then ask questions across all of them. I'll find the relevant pages and cite them.`
                : `Ask across ${info.stats.docs === 1 ? "the 1 document" : `all ${info.stats.docs} documents`} in ${info.workspace.name}. I'll find the relevant pages and cite them.`}
          </div>
        )}
        {messages?.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="msg msg-user">
              {m.segments.map((s) => s.text).join("")}
            </div>
          ) : (
            <div key={m.id} className="msg msg-ai">
              {m.segments.map((s, i) => (
                <span key={i}>
                  <RichText text={s.text} />
                  {dedupe(s.citations, (c) => citeLabel(c, m.refs)).map((c, j) => (
                    <button key={j} className="cite" title={c.citedText} onClick={() => openCitation(c, m.refs)}>
                      ↳ {citeLabel(c, m.refs)}
                    </button>
                  ))}
                </span>
              ))}
              {m.pending && !m.segments.some((s) => s.text) && (
                <span className="typing">
                  <span />
                  <span />
                  <span />
                </span>
              )}
              {m.error && <div className="error-text mt-8">{m.error}</div>}
            </div>
          ),
        )}
        {messages && messages.length === 0 && scope === "doc" && active && info.capabilities.ai && (
          <div className="wb-sum">
            <div className="wb-sum-k">
              <I.file size={13} /> This document
            </div>
            <div className="wb-facts">
              <span>Name</span>
              <b className="ellipsis">{active.name}</b>
              <span>Pages</span>
              <b>{active.pageCount}</b>
              <span>Updated</span>
              <b>{timeAgo(active.updatedAt)}</b>
              {active.tags.length > 0 && (
                <>
                  <span>Tags</span>
                  <b>{active.tags.map((t) => `#${t}`).join(" ")}</b>
                </>
              )}
            </div>
            <button
              className="btn btn-sm btn-tonal mt-12"
              disabled={busy}
              onClick={() => send("Summarize this document: the main points, the people or companies involved, key dates and amounts, and anything that needs action.")}
            >
              <I.sparkle size={13} /> Summarize with key facts
            </button>
            <div className="tiny faint mt-8">Answers cite the page they came from. Uses AI credits.</div>
          </div>
        )}
        {messages && messages.length < 2 && info.capabilities.ai && (
          <div className="suggestions">
            {(scope === "doc" && active ? docSuggestions(active.name, active.tags) : KB_SUGGESTIONS).map((s) => (
              <button key={s} className="chip" onClick={() => send(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="panel-foot">
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            rows={1}
            value={input}
            placeholder={scope === "doc" ? "Ask about this document…" : "Ask across your library…"}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            aria-label="Message"
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !input.trim()} aria-label="Send">
            {busy ? <span className="spinner" /> : "→"}
          </button>
        </form>
      </div>
    </>
  );
}

function dedupe<T>(list: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
