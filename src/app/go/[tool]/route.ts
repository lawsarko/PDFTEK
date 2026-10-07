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
  "read-aloud": PICK("read"),
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

export async function GET(_req: Request, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  const target = TASKS[tool];
  if (!target) return go("/");
  const user = await currentUser();
  if (!user) return go(`/signup?next=${encodeURIComponent(`/go/${tool}`)}`);
  const wid = firstWorkspaceFor(user.id) ?? createWorkspace(`${user.name.split(" ")[0]}'s workspace`, user.id);
  return go(`/app/${wid}${target}`);
}

/**
 * Relative redirect: the browser resolves it against the address it is already on. Behind a host
 * like Render, req.url is the internal address (http://0.0.0.0:10000), so absolute URLs built from
 * it send visitors to an unreachable page.
 */
function go(path: string) {
  return new Response(null, { status: 307, headers: { Location: path, "Cache-Control": "no-store" } });
}
