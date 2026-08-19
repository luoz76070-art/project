import { BookOpen } from "lucide-react";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BorrowStatusBadge } from "@/components/borrow-status-badge";
import { formatDate } from "@/lib/utils";
import { BorrowActionButtons } from "./borrow-action-buttons";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface SearchParams {
  status?: string;
}

async function BorrowList({ status }: { status?: string }) {
  const where: Record<string, unknown> = {};
  if (status && status !== "ALL") where.status = status;

  const borrows = await db.borrow.findMany({
    where,
    include: { user: true, book: true },
    orderBy: { requestedAt: "desc" },
    take: 100,
  });

  if (borrows.length === 0) {
    return (
      <Card className="border-dashed bg-card/50">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          暂无借阅记录
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {borrows.map((b) => (
            <li key={b.id} className="flex items-center gap-4 p-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent">
                <BookOpen className="h-5 w-5 text-primary/60" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{b.book.title}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {b.user.displayName}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  <span>申请：{formatDate(b.requestedAt)}</span>
                  <span>{b.requestedDays} 天</span>
                  {b.borrowedAt && <span>借出于：{formatDate(b.borrowedAt)}</span>}
                  {b.dueAt && <span>到期：{formatDate(b.dueAt)}</span>}
                  {b.returnedAt && <span>归还：{formatDate(b.returnedAt)}</span>}
                  {b.rejectReason && <span>拒绝原因：{b.rejectReason}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <BorrowStatusBadge status={b.status} />
                <BorrowActionButtons
                  borrowId={b.id}
                  status={b.status}
                  bookTitle={b.book.title}
                />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default async function AdminBorrowsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { status = "ALL" } = await searchParams;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">借阅审批</h1>
        <p className="mt-1 text-sm text-muted-foreground">审批学生提交的借阅申请、标记发书、查看历史。</p>
      </div>

      <Tabs defaultValue={status}>
        <TabsList>
          <TabsTrigger value="ALL">全部</TabsTrigger>
          <TabsTrigger value="PENDING">待审批</TabsTrigger>
          <TabsTrigger value="APPROVED">已批准</TabsTrigger>
          <TabsTrigger value="BORROWED">已借出</TabsTrigger>
          <TabsTrigger value="RETURNED">已归还</TabsTrigger>
          <TabsTrigger value="REJECTED">已拒绝</TabsTrigger>
        </TabsList>
        <TabsContent value={status} className="mt-4">
          <BorrowList status={status} />
        </TabsContent>
      </Tabs>
    </div>
  );
}