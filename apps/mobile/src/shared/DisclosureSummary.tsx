import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export function DisclosureSummary({ children }: { children: ReactNode }) {
  return <summary><ChevronRight className="settings-chevron" size={16} aria-hidden="true" /><span>{children}</span></summary>;
}
