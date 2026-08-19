import Link from "next/link";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BorrowStatusBadge } from "@/components/borrow-status-badge";
import { formatDate } from "@/lib/utils";
import { BookOpen, Clock } from "lucide-react";

export default async function RequestPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const books = await db.book.findMany({
    where: { isActive: true },
    orderBy: { title: "asc" },
  });

  const myRequests = await db.borrow.findMany({
    where: {
      userId: session.user.id,
      status: { in: ["PENDING", "APPROVED", "BORROWED", "REJECTED"] },
    },
    include: { book: true },
    orderBy: { requestedAt: "desc" },
    take: 20,
  });

  const myQueues = await db.reservation.findMany({
    where: { userId: session.user.id, fulfilledAt: null },
    include: { book: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">申请借阅</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          选择一本图书，提交借阅申请。库存充足时直接进入审批；库存为 0 时自动进入排队队列。
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          可选图书（共 {books.length} 本）
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {books.map((book) => {
            const available = book.availableCopies > 0;
            return (
              <Card key={book.id} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent">
                      <BookOpen className="h-5 w-5 text-primary/60" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-sm font-semibold leading-tight">
                        {book.title}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{book.author}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">可借 / 总数</span>
                    <span className={available ? "font-semibold text-[#1A5E3A]" : "font-semibold text-[#8A6A0F]"}>
                      {book.availableCopies} / {book.totalCopies}
                    </span>
                  </div>
                  <Link
                    href={`/books${available ? "" : "?availability=empty"}`}
                    className="mt-auto text-center text-xs text-primary hover:underline"
                  >
                    在图书列表中申请 →
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">我的借阅历史</h2>
        {myRequests.length === 0 ? (
          <Card className="border-dashed bg-card/50">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              暂无申请记录
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {myRequests.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
                      <BookOpen className="h-4 w-4 text-primary/60" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.book.title}</div>
                      <div className="text-xs text-muted-foreground">
                        申请于 {formatDate(r.requestedAt)} · {r.requestedDays} 天
                      </div>
                    </div>
                    <BorrowStatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>

      {myQueues.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">我的排队</h2>
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {myQueues.map((q) => (
                  <li key={q.id} className="flex items-center gap-3 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#FDF4DC] text-[#8A6A0F]">
                      <Clock className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{q.book.title}</div>
                      <div className="text-xs text-muted-foreground">
                        加入于 {formatDate(q.createdAt)}
                      </div>
                    </div>
                    <Badge variant="warning">第 {q.queuePosition} 位</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}