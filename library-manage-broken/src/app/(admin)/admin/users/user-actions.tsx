"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast-helper";
import { setUserActive, updateUserRole } from "@/lib/actions/users";

export function UserActions({
  userId,
  role,
  isActive,
  username,
}: {
  userId: string;
  role: string;
  isActive: boolean;
  username: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  const run = async (
    fn: () => Promise<{ ok: boolean; message?: string; error?: string }>,
    success: string
  ) => {
    setPending(true);
    const res = await fn();
    setPending(false);
    if (!res.ok) {
      toast({ title: "操作失败", description: res.error, variant: "destructive" });
    } else {
      toast({ title: success, description: `@${username} ${res.message ?? ""}` });
      router.refresh();
    }
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(
            () => updateUserRole(userId, role === "ADMIN" ? "STUDENT" : "ADMIN"),
            "角色已更新"
          )
        }
      >
        切换为{role === "ADMIN" ? "学生" : "管理员"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => setUserActive(userId, !isActive), isActive ? "已停用" : "已启用")}
      >
        {isActive ? "停用" : "启用"}
      </Button>
    </div>
  );
}