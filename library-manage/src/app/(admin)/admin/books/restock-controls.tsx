"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast-helper";
import { restockBook, toggleBookActive } from "@/lib/actions/books";

export function RestockControls({
  bookId,
  title,
  currentCopies,
  totalCopies,
  isActive,
}: {
  bookId: string;
  title: string;
  currentCopies: number;
  totalCopies: number;
  isActive: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [delta, setDelta] = useState(1);
  const [pending, setPending] = useState(false);

  const handle = async (
    fn: () => Promise<{ ok: boolean; message?: string; error?: string }>,
    success: string
  ) => {
    setPending(true);
    const res = await fn();
    setPending(false);
    if (!res.ok) {
      toast({ title: "操作失败", description: res.error, variant: "destructive" });
    } else {
      toast({ title: success, description: `《${title}》${res.message ?? ""}` });
      router.refresh();
    }
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <Input
        type="number"
        min={1}
        max={99}
        value={delta}
        onChange={(e) => setDelta(Math.max(1, Number(e.target.value) || 1))}
        className="h-9 w-16 text-center"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => handle(() => restockBook(bookId, delta), `已补货 +${delta}`)}
      >
        补货
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          handle(() => toggleBookActive(bookId), isActive ? "已下架" : "已上架")
        }
      >
        {isActive ? "下架" : "上架"}
      </Button>
    </div>
  );
}