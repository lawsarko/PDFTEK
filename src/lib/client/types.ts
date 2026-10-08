export type Plan = "free" | "pro" | "business";
export type Role = "owner" | "admin" | "member";

export type Doc = {
  id: string;
  name: string;
  pageCount: number;
  size: number;
  sourceType: string;
  status: string;
  scanned: boolean;
  tags: string[];
  checkedOutBy: { id: string; name: string } | null;
  checkedOutAt: number | null;
  assignedTo: { id: string; name: string } | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  versionId: string | null;
};

export type Version = { id: string; version: number; size: number; pageCount: number; note: string; createdBy: string; createdAt: number; sha256: string };

export type WorkspaceInfo = {
  workspace: { id: string; name: string; plan: Plan; basePlan: Plan; trialEndsAt: number | null; playbook: string; hasSubscription: boolean };
  role: Role;
  me: { id: string; name: string; email: string; is_guest?: boolean };
  billing: import("@/lib/plans").Entitlements;
  stats: { docs: number; pages: number };
  capabilities: { ai: boolean; email: boolean; serverOffice: boolean; billing: boolean };
};

export type Member = { id: string; name: string; email: string; role: Role; created_at: number };

export type Citation = { documentIndex: number; documentTitle: string | null; citedText: string; startPage?: number; endPage?: number };
export type Segment = { text: string; citations: Citation[] };
export type SourceRef = { documentId: string; documentName: string; page?: number };
export type ChatMessage = { id: string; role: "user" | "assistant"; segments: Segment[]; refs: SourceRef[]; createdAt: number; pending?: boolean; error?: string };

export type ExtractionTable = { title: string; columns: string[]; rows: string[][] };
export type Extraction = { id: string; preset: string; title: string; result: { summary: string; tables: ExtractionTable[] }; createdAt: number };

export type Activity = { id: string; action: string; actor: string; documentId: string | null; documentName: string | null; meta: Record<string, unknown>; createdAt: number };
