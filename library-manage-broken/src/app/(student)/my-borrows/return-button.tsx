"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast-helper";
import { returnBorrow } from "@/lib/actions/borrows";

export function ReturnButton({ borrowId, title }: { borrowId: string; title: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={async () => {
        if (!confirm(`确认归还《${title}》？`)) return;
        setPending(true);
        const res = await returnBorrow(borrowId);
        setPending(false);
        if (!res.ok) {
          toast({ title: "归还失败", description: res.error, variant: "destructive" });
        } else {
          toast({ title: "已归还", description: `《${title}》已归还成功` });
          router.refresh();
        }
      }}
    >
      归还
    </Button>
  );
}