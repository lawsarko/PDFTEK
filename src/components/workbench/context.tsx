"use client";
import { createContext, useContext } from "react";
import type { Doc, WorkspaceInfo } from "@/lib/client/types";
import type { Flash } from "../pdf-viewer";

export type WB = {
  wid: string;
  info: WorkspaceInfo;
  reloadInfo: () => Promise<void>;
  docs: Doc[];
  reloadDocs: () => Promise<void>;
  active: Doc | null;
  openDoc: (id: string | null, flash?: Omit<Flash, "nonce">) => void;
  upsertDoc: (d: Doc) => void;
  flash: Flash | null;
  jump: (page: number, text?: string) => void;
  requirePro: (feature: string) => boolean;
  showUpload: () => void;
  setMobileView: (v: "library" | "document" | "assistant") => void;
  assistantTab: string;
  setAssistantTab: (t: string) => void;
};

export const WorkbenchContext = createContext<WB | null>(null);

export function useWB(): WB {
  const v = useContext(WorkbenchContext);
  if (!v) throw new Error("Workbench context missing");
  return v;
}
