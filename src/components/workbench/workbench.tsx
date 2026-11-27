"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errMsg } from "@/lib/client/api";
import type { Doc, WorkspaceInfo } from "@/lib/client/types";
import { useToast } from "../toast";
import { I } from "../icons";
import type { Flash } from "../pdf-viewer";
import { WorkbenchContext, type WB } from "./context";
import { TopBar } from "./topbar";
import { DocumentPane } from "./document-pane";
import { UploadModal } from "./upload-modal";
import { daysLeft, notifyPaywall, openSaveAccount, startCheckout } from "../paywall";
import { FREE_LIMITS, PRODUCTS, TRIAL_DAYS, usd } from "@/lib/plans";

export function Workbench({ wid }: { wid: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [uploadOpen, setUploadOpen] = useState<false | "upload" | "images" | "scan" | "cloud">(() => {
    const add = params.get("add");
    return add === "images" || add === "scan" || add === "upload" || add === "cloud" ? add : false;
  });
  const [, setMobileView] = useState<"library" | "document" | "assistant">(() => (params.get("do") === "ask" ? "assistant" : "library"));
  const [assistantTab, setAssistantTab] = useState("chat");
  const [aiOpen, setAiOpenState] = useState(() => params.get("do") === "ask");
  const [section, setSection] = useState<"home" | "documents">("home");
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const activeId = params.get("doc");
  const [pending, setPending] = useState<{ action: string; from: string | null } | null>(null);

  // Back from connecting a cloud account.
  useEffect(() => {
    const ok = params.get("cloud");
    const bad = params.get("cloud_error");
    if (ok) toast(`${ok === "google" ? "Google Drive" : ok === "dropbox" ? "Dropbox" : "OneDrive"} connected. Choose the files to open.`, "success");
    if (bad) toast(bad, "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A tool picked before any document was open runs as soon as the uploaded document opens.
  useEffect(() => {
    if (!pending || !activeId || activeId === pending.from) return;
    router.replace(`/app/${wid}?doc=${activeId}&do=${pending.action}`, { scroll: false });
    setPending(null);
  }, [pending, activeId, router, wid]);

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

  // Remembered choices: the theme, and whether Ask AI stays open beside documents (desktop).
  useEffect(() => {
    try {
      if (localStorage.getItem("pdftek-theme") === "dark") setThemeState("dark");
      if (localStorage.getItem("pdftek-ai-open") === "1" && window.innerWidth > 960) setAiOpenState(true);
    } catch {}
  }, []);
  const setAiOpen = useCallback((v: boolean) => {
    setAiOpenState(v);
    try {
      if (window.innerWidth > 960) localStorage.setItem("pdftek-ai-open", v ? "1" : "0");
    } catch {}
  }, []);
  const setTheme = useCallback((t: "light" | "dark") => {
    setThemeState(t);
    try {
      localStorage.setItem("pdftek-theme", t);
    } catch {}
  }, []);
  // On a phone Ask AI covers the screen, so going to a page (a citation, a search hit) closes it.
  const showView = useCallback(
    (v: "library" | "document" | "assistant") => {
      setMobileView(v);
      if (v === "assistant") setAiOpen(true);
      else if (window.innerWidth <= 960 && aiOpen) setAiOpenState(false);
    },
    [aiOpen, setAiOpen],
  );

  const active = useMemo(() => docs?.find((d) => d.id === activeId) ?? null, [docs, activeId]);

  // A document opened by link that the list doesn't have yet (just created by a tool): fetch the list once.
  const refetched = useRef<string | null>(null);
  useEffect(() => {
    if (!activeId || !docs || docs.some((d) => d.id === activeId) || refetched.current === activeId) return;
    refetched.current = activeId;
    void reloadDocs();
  }, [activeId, docs, reloadDocs]);

  const openDoc = useCallback(
    (id: string | null, f?: Omit<Flash, "nonce">) => {
      router.replace(id ? `/app/${wid}?doc=${id}` : `/app/${wid}`, { scroll: false });
      if (id) showView("document");
      if (f) setTimeout(() => setFlash({ ...f, nonce: Date.now() }), 250);
    },
    [router, wid, showView],
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

  const jump = useCallback(
    (page: number, text?: string) => {
      setFlash({ page, text, nonce: Date.now() });
      showView("document");
    },
    [showView],
  );

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
      <div className="app mk wb2" data-theme={theme}>
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
    showUpload: (tab = "upload") => setUploadOpen(tab),
    queueAction: (action) => {
      setPending({ action, from: activeId });
      setUploadOpen("upload");
    },
    setMobileView: showView,
    assistantTab,
    setAssistantTab,
    aiOpen,
    openAI: (tab) => {
      if (tab) setAssistantTab(tab);
      setMobileView("assistant");
      setAiOpen(true);
    },
    closeAI: () => {
      setAiOpen(false);
      setMobileView(activeId ? "document" : "library");
    },
    section,
    setSection: (v) => {
      setSection(v);
      if (activeId) openDoc(null);
    },
    theme,
    setTheme,
  };

  return (
    <WorkbenchContext.Provider value={ctx}>
      <div className="app mk wb2" data-theme={theme} data-mode={active ? "doc" : "home"}>
        {!active && <TopBar />}
        {info.me.is_guest && <GuestBanner paid={info.billing.membership || info.billing.credits > 0} />}
        {!info.me.is_guest && info.me.email_verified === false && info.capabilities.accountEmail && <VerifyBanner email={info.me.email} />}
        {!info.me.is_guest && <TrialBanner wid={wid} info={info} />}
        <div className="main wb-main" data-ai={aiOpen || undefined}>
          <DocumentPane key={active?.id ?? (activeId ? `pending-${activeId}` : "none")} />
        </div>
        {!active && (
          <nav className="wb-bnav show-mobile" aria-label="Main">
            <button className={section === "home" ? "on" : ""} onClick={() => setSection("home")}>
              <span className="wb-pill"><I.home size={20} /></span>Home
            </button>
            <button className={section === "documents" ? "on" : ""} onClick={() => setSection("documents")}>
              <span className="wb-pill"><I.folder size={20} /></span>Files
            </button>
            <button className="big" onClick={() => setUploadOpen("scan")}>
              <span className="wb-pill"><I.camera size={24} /></span>Scan
            </button>
            <Link href={`/app/${wid}/clients`}>
              <span className="wb-pill"><I.users size={20} /></span>Clients
            </Link>
            <Link href={`/app/${wid}/settings?tab=profile`}>
              <span className="wb-pill"><I.user size={20} /></span>Account
            </Link>
          </nav>
        )}
        {uploadOpen && (
          <UploadModal
            initialTab={uploadOpen}
            onClose={() => {
              setUploadOpen(false);
              // Closed without uploading: forget the tool that was waiting for a file.
              setTimeout(() => setPending((p) => (p && p.from === new URLSearchParams(window.location.search).get("doc") ? null : p)), 1500);
            }}
          />
        )}
      </div>
    </WorkbenchContext.Provider>
  );
}

/**
 * The free Pro trial in the workbench: an offer for accounts that haven't had it (card at checkout,
 * first charge when it ends), then a countdown to the first charge while it runs. Dismissing hides
 * it for a day, except in the trial's last two days.
 */
function TrialBanner({ wid, info }: { wid: string; info: WorkspaceInfo }) {
  const toast = useToast();
  const e = info.billing;
  const mode = e.trialEndsAt ? "active" : e.trialAvailable && info.role === "owner" && !e.membership ? "offer" : null;
  const key = `pdftek-trial-banner:${wid}:${mode}`;
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      const at = Number(localStorage.getItem(key));
      const days = e.trialEndsAt ? daysLeft(e.trialEndsAt) : 99;
      // The last two days of a trial always show, so nobody is surprised when it ends.
      setHidden(Boolean(at && Date.now() - at < 86_400_000 && days > 2));
    } catch {
      setHidden(false);
    }
  }, [key, e.trialEndsAt]);
  if (!mode || hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(key, String(Date.now()));
    } catch {}
  };
  const act = async () => {
    setBusy(true);
    try {
      if (mode === "offer") await startCheckout("pro_trial", wid);
      else window.location.href = `/app/${wid}/settings?tab=billing`;
    } catch (err) {
      toast(errMsg(err), "error");
    } finally {
      setBusy(false);
    }
  };
  const ends = e.trialEndsAt ? new Date(e.trialEndsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  return (
    <div className={`guest-banner trial-banner ${mode === "active" && e.trialEndsAt && daysLeft(e.trialEndsAt) <= 2 ? "urgent" : ""}`}>
      <I.sparkle size={14} />
      <span className="grow">
        {mode === "offer" ? (
          <>
            <b>Try everything in Pro free for {TRIAL_DAYS} days.</b>{" "}
            <span className="hide-mobile">Editing, e-signatures, bulk tools and AI. Then {usd(PRODUCTS.pro_trial.cents)}/month; cancel anytime before the trial ends and you won&apos;t be charged.</span>
          </>
        ) : (
          <>
            <b>Pro trial: {daysLeft(e.trialEndsAt!)} day{daysLeft(e.trialEndsAt!) === 1 ? "" : "s"} left.</b> Pro continues at {usd(PRODUCTS.pro_trial.cents)}/month from {ends}. To stop, cancel before then and you won&apos;t be charged.
          </>
        )}
      </span>
      <button className="btn btn-sm btn-primary" onClick={act} disabled={busy}>
        {busy && <span className="spinner" />} {mode === "offer" ? "Start free trial" : "Manage plan"}
      </button>
      <button className="btn btn-sm btn-ghost" onClick={dismiss} aria-label="Dismiss">
        <I.x size={14} />
      </button>
    </div>
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
      await api("/api/auth/verify/resend", { method: "POST", json: {} });
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
        <Link className="btn btn-sm btn-ghost hide-mobile" href="/login">Sign in</Link>
      </div>
    );
  }
  return (
    <div className="guest-banner">
      <I.clock size={14} />
      <span className="grow">
        You&apos;re using pdftek without an account. Files are deleted after 24 hours. <b>Create a free account</b> to keep them and get {FREE_LIMITS.free.tasksPerDay} free tasks a day.
      </span>
      <Link className="btn btn-sm btn-primary" href="/signup">Create free account</Link>
      <Link className="btn btn-sm btn-ghost hide-mobile" href="/login">Sign in</Link>
    </div>
  );
}
