"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast-helper";
import { requestBorrow } from "@/lib/actions/borrows";

export function BookRequestButton({
  bookId,
  available,
  title,
}: {
  bookId: string;
  available: boolean;
  title: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [showDays, setShowDays] = useState(false);
  const [days, setDays] = useState(30);

  if (!available) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const res = await requestBorrow({ bookId, requestedDays: 30 });
          setPending(false);
          if (!res.ok) {
            toast({ title: "加入排队失败", description: res.error, variant: "destructive" });
          } else {
            toast({
              title: "已加入排队",
              description: `《${title}》当前第 ${res.queuePosition} 位`,
            });
            router.refresh();
          }
        }}
      >
        加入排队
      </Button>
    );
  }

  if (!showDays) {
    return (
      <Button size="sm" className="w-full" onClick={() => setShowDays(true)}>
        申请借阅
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        className="h-9 flex-1 rounded-lg border border-input bg-card px-2 text-xs"
      >
        <option value={7}>7 天</option>
        <option value={14}>14 天</option>
        <option value={30}>30 天</option>
        <option value={60}>60 天</option>
      </select>
      <Button
        size="sm"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const res = await requestBorrow({ bookId, requestedDays: days });
          setPending(false);
          if (!res.ok) {
            toast({ title: "申请失败", description: res.error, variant: "destructive" });
          } else {
            toast({
              title: "申请已提交",
              description: `《${title}》已提交审批，等待管理员处理`,
            });
            setShowDays(false);
            router.refresh();
          }
        }}
      >
        确认
      </Button>
    </div>
  );
}