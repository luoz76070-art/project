"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast-helper";
import { createUser } from "@/lib/actions/users";

export function AddUserButton() {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const [form, setForm] = useState({
    username: "",
    password: "",
    displayName: "",
    role: "STUDENT" as "STUDENT" | "ADMIN",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    const res = await createUser(form);
    setPending(false);
    if (!res.ok) {
      toast({ title: "新增失败", description: res.error, variant: "destructive" });
    } else {
      toast({ title: "已新增", description: `@${form.username} 已创建` });
      setOpen(false);
      setForm({ username: "", password: "", displayName: "", role: "STUDENT" });
      router.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          新增用户
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增用户</DialogTitle>
          <DialogDescription>创建账号并指定角色。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                required
                minLength={3}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="字母数字下划线"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">显示名</Label>
              <Input
                id="displayName"
                required
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">初始密码</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">角色</Label>
            <select
              id="role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as "STUDENT" | "ADMIN" })}
              className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
            >
              <option value="STUDENT">学生</option>
              <option value="ADMIN">管理员</option>
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "提交中..." : "确认新增"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}