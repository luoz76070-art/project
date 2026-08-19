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
import { createBook } from "@/lib/actions/books";

const CATEGORIES = ["文学", "计算机", "历史", "哲学", "艺术", "科学"];

export function AddBookButton() {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const [form, setForm] = useState({
    title: "",
    author: "",
    isbn: "",
    category: "文学",
    totalCopies: 1,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    const res = await createBook({
      title: form.title,
      author: form.author,
      isbn: form.isbn || null,
      category: form.category,
      totalCopies: form.totalCopies,
    });
    setPending(false);
    if (!res.ok) {
      toast({ title: "新增失败", description: res.error, variant: "destructive" });
    } else {
      toast({ title: "已新增", description: `《${form.title}》已加入馆藏` });
      setOpen(false);
      setForm({ title: "", author: "", isbn: "", category: "文学", totalCopies: 1 });
      router.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          新增图书
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增图书</DialogTitle>
          <DialogDescription>填写图书基本信息，库存数量将初始化为可借数量。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">书名</Label>
            <Input
              id="title"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="author">作者</Label>
            <Input
              id="author"
              required
              value={form.author}
              onChange={(e) => setForm({ ...form, author: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="isbn">ISBN</Label>
              <Input
                id="isbn"
                value={form.isbn}
                onChange={(e) => setForm({ ...form, isbn: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">分类</Label>
              <select
                id="category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="totalCopies">总数量</Label>
            <Input
              id="totalCopies"
              type="number"
              min={1}
              max={99}
              value={form.totalCopies}
              onChange={(e) =>
                setForm({ ...form, totalCopies: Math.max(1, Number(e.target.value) || 1) })
              }
            />
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