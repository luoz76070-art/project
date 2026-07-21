import { redirect } from "next/navigation";
import { BookOpen, Clock } from "lucide-react";
import { auth } from "@/lib/auth";
import { getMyBorrows } from "@/lib/actions/users";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BorrowStatusBadge } from "@/components/borrow-status-badge";
import { formatDate, formatShortDate } from "@/lib/utils";
import { ReturnButton } from "./return-button";

export default async function MyBorrowsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { active, history, reservations } = await getMyBorrows();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">我的借阅</h1>
        <p className="mt-1 text-sm text-muted-foreground">查看借阅进度、归还图书、跟踪排队情况。</p>
      </div>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">当前借阅 ({active.length})</TabsTrigger>
          <TabsTrigger value="history">历史记录 ({history.length})</TabsTrigger>
          <TabsTrigger value="queue">排队中 ({reservations.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          {active.length === 0 ? (
            <EmptyState message="当前没有进行中的借阅" />
          ) : (
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {active.map((b) => (
                    <li key={b.id} className="flex items-center gap-4 p-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent">
                        <BookOpen className="h-5 w-5 text-primary/60" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{b.book.title}</div>
                        <div className="text-xs text-muted-foreground">{b.book.author}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                          <span>申请：{formatDate(b.requestedAt)}</span>
                          {b.dueAt && <span>到期：{formatShortDate(b.dueAt)}</span>}
                          <span>{b.requestedDays} 天</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <BorrowStatusBadge status={b.status} />
                        {["BORROWED", "APPROVED", "OVERDUE"].includes(b.status) && (
                          <ReturnButton borrowId={b.id} title={b.book.title} />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {history.length === 0 ? (
            <EmptyState message="暂无历史记录" />
          ) : (
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {history.map((b) => (
                    <li key={b.id} className="flex items-center gap-4 p-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <BookOpen className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{b.book.title}</div>
                        <div className="text-xs text-muted-foreground">{b.book.author}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {b.returnedAt ? `归还于 ${formatDate(b.returnedAt)}` : ""}
                          {b.rejectReason && ` · 原因：${b.rejectReason}`}
                        </div>
                      </div>
                      <BorrowStatusBadge status={b.status} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="queue" className="mt-4">
          {reservations.length === 0 ? (
            <EmptyState message="当前未在排队队列中" />
          ) : (
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {reservations.map((r) => (
                    <li key={r.id} className="flex items-center gap-4 p-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#FDF4DC] text-[#8A6A0F]">
                        <Clock className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{r.book.title}</div>
                        <div className="text-xs text-muted-foreground">{r.book.author}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          加入于 {formatDate(r.createdAt)}
                        </div>
                      </div>
                      <Badge variant="warning">第 {r.queuePosition} 位</Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card className="border-dashed bg-card/50">
      <CardContent className="py-12 text-center text-sm text-muted-foreground">{message}</CardContent>
    </Card>
  );
}