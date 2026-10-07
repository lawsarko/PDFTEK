import { NextResponse } from "next/server";
import { currentUser, firstWorkspaceFor, createWorkspace } from "@/lib/auth";

/**
 * Deep links from the marketing menu ("/go/pdf-to-word", "/go/sign", …) straight into the right
 * tool. Visitors who aren't signed in go through signup first and come back here afterwards.
 */
const PICK = (action: string) => `/tools?tool=pick&do=${action}`;
const TASKS: Record<string, string> = {
  "to-pdf": "/tools?tool=topdf",
  "word-to-pdf": "/tools?tool=topdf",
  "excel-to-pdf": "/tools?tool=topdf",
  "powerpoint-to-pdf": "/tools?tool=topdf",
  "jpg-to-pdf": "?add=images",
  "scan-to-pdf": "?add=scan",
  "pdf-to-word": PICK("convert-docx"),
  "pdf-to-excel": PICK("convert-xlsx"),
  "pdf-to-powerpoint": PICK("convert-pptx"),
  "pdf-to-jpg": PICK("convert-jpg"),
  edit: PICK("edit"),
  sign: PICK("sign"),
  ask: PICK("ask"),
  ocr: PICK("ocr"),
  merge: "/tools?tool=merge",
  split: "/tools?tool=split",
  compress: "/tools?tool=optimize",
  rotate: "/tools?tool=rotate",
  organize: "/tools?tool=organize",
  watermark: "/tools?tool=watermark",
  "page-numbers": "/tools?tool=page_numbers",
  compare: "/compare",
};

export async function GET(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  const target = TASKS[tool];
  // Relative to the request's own host, so it works behind proxies and on any domain.
  const base = req.url;
  if (!target) return NextResponse.redirect(new URL("/", base));
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL(`/signup?next=${encodeURIComponent(`/go/${tool}`)}`, base));
  const wid = firstWorkspaceFor(user.id) ?? createWorkspace(`${user.name.split(" ")[0]}'s workspace`, user.id);
  return NextResponse.redirect(new URL(`/app/${wid}${target}`, base));
}
