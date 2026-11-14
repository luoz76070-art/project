import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";

/** U6: empty states carry the brand mark instead of a generic icon. */
export function EmptyState({ title, children, compact = false, className = "" }: { title: string; children?: ReactNode; compact?: boolean; className?: string }) {
  return <div className={`empty-brand${compact ? " compact" : ""}${className ? ` ${className}` : ""}`}>
    <span className="empty-illustration"><BrandMark size={compact ? 28 : 44} /></span>
    <strong>{title}</strong>
    {children && <p>{children}</p>}
  </div>;
}
