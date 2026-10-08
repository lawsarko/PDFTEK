import { currentOrGuest } from "@/lib/auth";

/**
 * Deep links from the marketing menu ("/go/pdf-to-word", "/go/sign", …) straight into the right
 * tool. Visitors without an account get a guest session, so free tools work without signing up.
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
  protect: "/tools?tool=protect",
  unlock: "/tools?tool=unlock",
  rotate: "/tools?tool=rotate",
  organize: "/tools?tool=organize",
  watermark: "/tools?tool=watermark",
  "page-numbers": "/tools?tool=page_numbers",
  compare: "/compare",
  start: "",
};

export async function GET(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  const target = TASKS[tool];
  if (target === undefined) return go("/");
  const { workspaceId } = await currentOrGuest(req);
  return go(`/app/${workspaceId}${target}`);
}

/**
 * Relative redirect: the browser resolves it against the address it is already on. Behind a host
 * like Render, req.url is the internal address (http://0.0.0.0:10000), so absolute URLs built from
 * it send visitors to an unreachable page.
 */
function go(path: string) {
  return new Response(null, { status: 307, headers: { Location: path, "Cache-Control": "no-store" } });
}
