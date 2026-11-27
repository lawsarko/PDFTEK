import Link from "next/link";
import { ToolIcon, toolColor } from "./tool-icon";
import { I } from "./icons";

/**
 * A tool card on the homepage, the Tools page and "related tools": the tool's illustrated icon, its
 * name, one line on what it does, and a small badge for how it's paid for. Hovering lifts the card,
 * lights it in the tool's colour and brings in an arrow.
 */
export function ToolTile({ href, slug, name, desc, badge, badgeKind }: { href: string; slug: string; name: string; desc: string; badge: string; badgeKind: "free" | "member" | "ai" }) {
  return (
    <Link href={href} className="tool-tile" style={{ ["--tc" as string]: toolColor(slug) }}>
      <span className="tool-tile-top">
        <ToolIcon slug={slug} size={54} />
        <span className={`tool-tile-badge ${badgeKind}`}>{badge}</span>
      </span>
      <b className="tool-tile-name">{name}</b>
      <span className="tool-tile-desc">{desc}</span>
      <span className="tool-tile-go" aria-hidden>
        <I.right size={14} />
      </span>
    </Link>
  );
}
