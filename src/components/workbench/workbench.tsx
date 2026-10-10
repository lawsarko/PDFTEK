"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errMsg } from "@/lib/client/api";
import type { Doc, WorkspaceInfo } from "@/lib/client/types";
import { useToast } from "../toast";
import { I } from "../icons";
import type { Flash } from "../pdf-viewer";
import { WorkbenchContext, type WB } from "./context";
import { TopBar } from "./topbar";
import { Library } from "./library";
import { DocumentPane } from "./document-pane";
import { Assistant } from "./assistant";
import { UploadModal } from "./upload-modal";
import { notifyPaywall, openSaveAccount } from "../paywall";
import { FREE_LIMITS } from "@/lib/plans";

export function Workbench({ wid }: { wid: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [uploadOpen, setUploadOpen] = useState<false | "upload" | "images" | "scan">(() => {
    const add = params.get("add");
    return add === "images" || add === "scan" || add === "upload" ? add : false;
  });
  const [mobileView, setMobileView] = useState<"library" | "document" | "assistant">(() => (params.get("do") === "ask" ? "assistant" : "library"));
  const [assistantTab, setAssistantTab] = useState("chat");
  const activeId = params.get("doc");

  const reloadInfo = useCallback(async () => {
    try {
      setInfo(await api<WorkspaceInfo>(`/api/workspaces/${wid}`));
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }, [wid, toast]);

  const reloadDocs = useCallback(async () => {
    try {
      const r = await api<{ documents: Doc[] }>(`/api/workspaces/${wid}/documents`);
      setDocs(r.documents);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }, [wid, toast]);

  useEffect(() => {
    void reloadInfo();
    void reloadDocs();
  }, [reloadInfo, reloadDocs]);

  // Light polling keeps locks, hand-offs and new uploads in sync across teammates.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reloadDocs();
    }, 20_000);
    return () => clearInterval(t);
  }, [reloadDocs]);

  // Default to the most recent document on desktop.
  useEffect(() => {
    if (!activeId && docs?.length && window.innerWidth > 960) {
      router.replace(`/app/${wid}?doc=${docs[0].id}`, { scroll: false });
    }
  }, [activeId, docs, router, wid]);

  const active = useMemo(() => docs?.find((d) => d.id === activeId) ?? null, [docs, activeId]);

  const openDoc = useCallback(
    (id: string | null, f?: Omit<Flash, "nonce">) => {
      router.replace(id ? `/app/${wid}?doc=${id}` : `/app/${wid}`, { scroll: false });
      if (id) setMobileView("document");
      if (f) setTimeout(() => setFlash({ ...f, nonce: Date.now() }), 250);
    },
    [router, wid],
  );

  const upsertDoc = useCallback((d: Doc) => {
    setDocs((list) => {
      if (!list) return [d];
      const i = list.findIndex((x) => x.id === d.id);
      if (i === -1) return [d, ...list];
      const copy = [...list];
      copy[i] = d;
      return copy;
    });
  }, []);

  const jump = useCallback((page: number, text?: string) => {
    setFlash({ page, text, nonce: Date.now() });
    setMobileView("document");
  }, []);

  const requirePro = useCallback(
    (feature: string) => {
      if (info && !info.billing.membership) {
        notifyPaywall({ code: "membership_required", message: `${feature} needs a Day Pass ($1.99 for 24 hours) or pdftek Pro.` });
        return false;
      }
      return true;
    },
    [info],
  );

  if (!info || !docs) {
    return (
      <div className="app">
        <div className="empty" style={{ margin: "auto" }}>
          <span className="spinner spinner-lg" />
        </div>
      </div>
    );
  }

  const ctx: WB = {
    wid,
    info,
    reloadInfo,
    docs,
    reloadDocs,
    active,
    openDoc,
    upsertDoc,
    flash,
    jump,
    requirePro,
    showUpload: () => setUploadOpen("upload"),
    setMobileView,
    assistantTab,
    setAssistantTab,
  };

  return (
    <WorkbenchContext.Provider value={ctx}>
      <div className="app">
        <TopBar />
        {info.me.is_guest && <GuestBanner paid={info.billing.membership || info.billing.credits > 0} />}
        {!info.me.is_guest && info.me.email_verified === false && info.capabilities.email && <VerifyBanner email={info.me.email} />}
        <div className="main" data-view={mobileView}>
          <Library />
          <DocumentPane key={active?.id ?? "none"} />
          <Assistant />
        </div>
        <nav className="mobile-nav">
          {(
            [
              ["library", "Library", <I.folder key="i" size={18} />],
              ["document", "Document", <I.file key="i" size={18} />],
              ["assistant", "Assistant", <I.sparkle key="i" size={18} />],
            ] as const
          ).map(([v, label, icon]) => (
            <button key={v} className={mobileView === v ? "active" : ""} onClick={() => setMobileView(v)}>
              {icon}
              {label}
            </button>
          ))}
        </nav>
        {uploadOpen && <UploadModal initialTab={uploadOpen} onClose={() => setUploadOpen(false)} />}
      </div>
    </WorkbenchContext.Provider>
  );
}

/** Reminds a new account to confirm its email (needed for password resets to reach them). */
function VerifyBanner({ email }: { email: string }) {
  const toast = useToast();
  const [state, setState] = useState<"idle" | "busy" | "sent" | "hidden">("idle");
  if (state === "hidden") return null;
  const resend = async () => {
    setState("busy");
    try {
      await api("/api/auth/verify/resend", { method: "POST" });
      setState("sent");
      toast(`Confirmation email sent to ${email}.`, "success");
    } catch (e) {
      setState("idle");
      toast(errMsg(e), "error");
    }
  };
  return (
    <div className="guest-banner">
      <I.mail size={14} />
      <span className="grow">
        {state === "sent" ? <>Check your inbox at <b>{email}</b> and click the link to confirm.</> : <>Please confirm your email address, <b>{email}</b>, so you can always recover your account.</>}
      </span>
      {state !== "sent" && (
        <button className="btn btn-sm btn-primary" onClick={resend} disabled={state === "busy"}>
          {state === "busy" && <span className="spinner" />} Resend email
        </button>
      )}
      <button className="btn btn-sm btn-ghost" onClick={() => setState("hidden")} aria-label="Dismiss">
        <I.x size={14} />
      </button>
    </div>
  );
}

/** Guests can do everything free without an account; this nudges them to keep their files (and anything they bought). */
function GuestBanner({ paid }: { paid: boolean }) {
  if (paid) {
    return (
      <div className="guest-banner">
        <I.lock size={14} />
        <span className="grow">
          <b>Your purchase is saved in this browser only.</b> Create your account to keep it and use it on any device.
        </span>
        <button className="btn btn-sm btn-primary" onClick={openSaveAccount}>Save my purchase</button>
        <a className="btn btn-sm btn-ghost hide-mobile" href="/login">Sign in</a>
      </div>
    );
  }
  return (
    <div className="guest-banner">
      <I.clock size={14} />
      <span className="grow">
        You&apos;re using pdftek without an account. Files are deleted after 24 hours. <b>Create a free account</b> to keep them and get {FREE_LIMITS.free.tasksPerDay} free tasks a day.
      </span>
      <a className="btn btn-sm btn-primary" href="/signup">Create free account</a>
      <a className="btn btn-sm btn-ghost hide-mobile" href="/login">Sign in</a>
    </div>
  );
}
