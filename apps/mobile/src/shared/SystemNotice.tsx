import type { ReactNode } from "react";
import { AlertCircle, Info } from "lucide-react";

export function SystemNotice({ children, error = false, className = "" }: { children: ReactNode; error?: boolean; className?: string }) {
  return <div className={`connection-notice system-notice ${error ? "error-notice" : ""} ${className}`} role={error ? "alert" : "status"}>
    {error ? <AlertCircle size={15} aria-hidden="true" /> : <Info size={15} aria-hidden="true" />}
    <div>{children}</div>
  </div>;
}
