import { cn } from "@/lib/utils";
import { BorrowStatus, BorrowStatusLabel } from "@/lib/enums";
import { Badge } from "@/components/ui/badge";

const VARIANT_MAP: Record<string, "default" | "secondary" | "success" | "warning" | "destructive" | "muted"> = {
  [BorrowStatus.PENDING]: "warning",
  [BorrowStatus.APPROVED]: "secondary",
  [BorrowStatus.BORROWED]: "default",
  [BorrowStatus.RETURNED]: "success",
  [BorrowStatus.OVERDUE]: "destructive",
  [BorrowStatus.REJECTED]: "muted",
};

export function BorrowStatusBadge({ status, className }: { status: string; className?: string }) {
  const variant = VARIANT_MAP[status] ?? "muted";
  const label = (BorrowStatusLabel as Record<string, string>)[status] ?? status;
  return (
    <Badge variant={variant} className={cn("font-medium", className)}>
      {label}
    </Badge>
  );
}