"use client";
import { I } from "../icons";
import { useWB } from "./context";
import { ChatPanel } from "./chat-panel";
import { ExtractPanel } from "./extract-panel";
import { AutomatePanel } from "./automate-panel";
import { WorkflowPanel } from "./workflow-panel";

const TABS: [string, string, React.ReactNode][] = [
  ["chat", "Chat", <I.chat key="i" size={13} />],
  ["extract", "Extract", <I.table key="i" size={13} />],
  ["automate", "Automate", <I.bolt key="i" size={13} />],
  ["workflow", "Workflow", <I.users key="i" size={13} />],
];

export function Assistant() {
  const { assistantTab, setAssistantTab } = useWB();
  return (
    <aside className="assistant">
      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={assistantTab === key} className={`tab ${assistantTab === key ? "active" : ""}`} onClick={() => setAssistantTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {assistantTab === "chat" && <ChatPanel />}
      {assistantTab === "extract" && <ExtractPanel />}
      {assistantTab === "automate" && <AutomatePanel />}
      {assistantTab === "workflow" && <WorkflowPanel />}
    </aside>
  );
}

export function AiUnavailable() {
  return (
    <div className="notice notice-info small">
      AI features are off: the server running pdftek doesn’t have an Anthropic API key. Add <span className="mono">ANTHROPIC_API_KEY=…</span> to the server’s <span className="mono">.env</span> file (or its hosting environment variables), then restart the server.
    </div>
  );
}

/** Minimal, safe formatting for assistant text: **bold** and preserved line breaks. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p.replace(/^#{1,4} /gm, "")}</span>))}
    </>
  );
}
