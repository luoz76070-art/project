"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast-helper";
import { approveBorrow, rejectBorrow, markAsBorrowed } from "@/lib/actions/borrows";

export function BorrowActionButtons({
  borrowId,
  status,
  bookTitle,
}: {
  borrowId: string;
  status: string;
  bookTitle: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  const run = async (
    fn: () => Promise<{ ok: boolean; message?: string; error?: string }>,
    successText: string
  ) => {
    setPending(true);
    const res = await fn();
    setPending(false);
    if (!res.ok) {
      toast({ title: "操作失败", description: res.error, variant: "destructive" });
    } else {
      toast({ title: successText, description: `《${bookTitle}》${res.message ?? ""}` });
      router.refresh();
    }
  };

  if (status === "PENDING") {
    return (
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => approveBorrow(borrowId), "已批准")}
        >
          批准
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={async () => {
            const reason = prompt(`拒绝《${bookTitle}》的原因（可空）：`) ?? "";
            await run(() => rejectBorrow(borrowId, reason), "已拒绝");
          }}
        >
          拒绝
        </Button>
      </div>
    );
  }

  if (status === "APPROVED") {
    return (
      <Button
        size="sm"
        disabled={pending}
        onClick={() => run(() => markAsBorrowed(borrowId), "已标记为借出")}
      >
        标记借出
      </Button>
    );
  }

  return null;
}