import { Suspense } from "react";
import { Search, BookOpen } from "lucide-react";
import { db } from "@/lib/db";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookRequestButton } from "./book-request-button";

interface SearchParams {
  q?: string;
  category?: string;
  availability?: string;
}

async function BooksList({ q, category, availability }: SearchParams) {
  const where: Record<string, unknown> = { isActive: true };
  if (q) {
    where.OR = [{ title: { contains: q } }, { author: { contains: q } }];
  }
  if (category && category !== "ALL") {
    where.category = category;
  }
  if (availability === "available") where.availableCopies = { gt: 0 };
  if (availability === "empty") where.availableCopies = 0;

  const books = await db.book.findMany({ where, orderBy: [{ title: "asc" }] });
  const categories = await db.book.findMany({
    where: { isActive: true, category: { not: null } },
    select: { category: true },
    distinct: ["category"],
  });
  const categoryList = categories.map((c) => c.category).filter(Boolean) as string[];

  if (books.length === 0) {
    return (
      <Card className="border-dashed bg-card/50">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <BookOpen className="mb-3 h-10 w-10 opacity-40" />
          <p>未找到符合条件的图书</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant="muted">共 {books.length} 本</Badge>
        {q && <Badge variant="outline">搜索：{q}</Badge>}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {books.map((book) => {
          const available = book.availableCopies > 0;
          return (
            <Card key={book.id} className="flex flex-col overflow-hidden">
              <div className="flex h-32 items-center justify-center bg-gradient-to-br from-accent to-muted">
                <BookOpen className="h-12 w-12 text-primary/40" />
              </div>
              <CardContent className="flex flex-1 flex-col gap-3 p-4">
                <div className="space-y-1">
                  <div className="line-clamp-2 text-base font-semibold leading-tight">
                    {book.title}
                  </div>
                  <div className="text-xs text-muted-foreground">{book.author}</div>
                  {book.category && (
                    <Badge variant="outline" className="mt-1 text-[10px]">
                      {book.category}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">可借</span>
                  <span
                    className={
                      available
                        ? "font-semibold text-[#1A5E3A]"
                        : "font-semibold text-[#8A6A0F]"
                    }
                  >
                    {book.availableCopies} / {book.totalCopies}
                  </span>
                </div>
                <div className="mt-auto pt-2">
                  <BookRequestButton
                    bookId={book.id}
                    available={available}
                    title={book.title}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <input type="hidden" name="categoryList" value={categoryList.join(",")} />
    </>
  );
}

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { q, category = "ALL", availability = "ALL" } = await searchParams;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">图书列表查询</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          浏览馆藏图书，搜索感兴趣的内容，或直接申请借阅。
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <form className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_180px_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="q"
                placeholder="搜索书名或作者..."
                defaultValue={q ?? ""}
                className="pl-9"
              />
            </div>
            <select
              name="category"
              defaultValue={category}
              className="h-10 rounded-lg border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="ALL">全部分类</option>
              {categoryList.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              name="availability"
              defaultValue={availability}
              className="h-10 rounded-lg border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="ALL">全部状态</option>
              <option value="available">在馆</option>
              <option value="empty">无库存</option>
            </select>
            <Button type="submit" variant="outline">
              筛选
            </Button>
          </form>
        </CardContent>
      </Card>

      <Suspense fallback={<div className="text-muted-foreground">加载中...</div>}>
        <BooksList q={q} category={category} availability={availability} />
      </Suspense>
    </div>
  );
}