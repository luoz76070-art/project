import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen } from "lucide-react";
import { RestockControls } from "./restock-controls";
import { AddBookButton } from "./add-book-button";

export default async function AdminBooksPage() {
  const books = await db.book.findMany({ orderBy: [{ isActive: "desc" }, { title: "asc" }] });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">图书管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">维护馆藏、补货与上下架。</p>
        </div>
        <AddBookButton />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="h-11 px-4 text-left font-medium">图书</th>
                  <th className="h-11 px-4 text-left font-medium">分类</th>
                  <th className="h-11 px-4 text-left font-medium">库存</th>
                  <th className="h-11 px-4 text-left font-medium">状态</th>
                  <th className="h-11 px-4 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {books.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
                          <BookOpen className="h-4 w-4 text-primary/60" />
                        </div>
                        <div>
                          <div className="font-medium">{b.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {b.author}
                            {b.isbn ? ` · ${b.isbn}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {b.category ? (
                        <Badge variant="outline">{b.category}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          b.availableCopies > 0
                            ? "font-medium text-[#1A5E3A]"
                            : "font-medium text-[#8A6A0F]"
                        }
                      >
                        {b.availableCopies}
                      </span>
                      <span className="text-muted-foreground"> / {b.totalCopies}</span>
                    </td>
                    <td className="px-4 py-3">
                      {b.isActive ? (
                        <Badge variant="success">在馆</Badge>
                      ) : (
                        <Badge variant="muted">已下架</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <RestockControls
                        bookId={b.id}
                        title={b.title}
                        currentCopies={b.availableCopies}
                        totalCopies={b.totalCopies}
                        isActive={b.isActive}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}