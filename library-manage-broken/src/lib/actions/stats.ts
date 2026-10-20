"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { BorrowStatus } from "@/lib/enums";

export type StatsOverview = {
  totalBooks: number;
  totalCopies: number;
  totalBorrows: number;
  activeBorrows: number;
  overdueCount: number;
  overdueRate: number;
  pendingCount: number;
  totalUsers: number;
  activeStudents: number;
};

export type DailyBorrowPoint = {
  date: string;
  count: number;
};

export type TopBook = {
  bookId: string;
  title: string;
  author: string;
  borrowCount: number;
};

export type CategoryDistribution = {
  category: string;
  count: number;
};

export type UserActivity = {
  userId: string;
  displayName: string;
  borrowCount: number;
};

export type StatusDistribution = {
  status: string;
  label: string;
  count: number;
};

export type StatsData = {
  overview: StatsOverview;
  dailyTrend: DailyBorrowPoint[];
  topBooks: TopBook[];
  categoryDistribution: CategoryDistribution[];
  userActivity: UserActivity[];
  statusDistribution: StatusDistribution[];
};

export async function getStats(): Promise<StatsData> {
  await requireAdmin();

  const [bookCount, borrowCount, pendingCount, overdueCount, activeBorrows, userCount, activeStudentCount] =
    await Promise.all([
      db.book.count(),
      db.borrow.count(),
      db.borrow.count({ where: { status: BorrowStatus.PENDING } }),
      db.borrow.count({ where: { status: BorrowStatus.OVERDUE } }),
      db.borrow.count({
        where: {
          status: { in: [BorrowStatus.APPROVED, BorrowStatus.BORROWED, BorrowStatus.OVERDUE] },
        },
      }),
      db.user.count(),
      db.user.count({ where: { role: "STUDENT", isActive: true } }),
    ]);

  const totalCopies = await db.book.aggregate({ _sum: { totalCopies: true } });
  const overdueRate =
    borrowCount === 0 ? 0 : Math.round((overdueCount / borrowCount) * 1000) / 10;

  // 30-day trend
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 29);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  const recentBorrows = await db.borrow.findMany({
    where: { requestedAt: { gte: thirtyDaysAgo } },
    select: { requestedAt: true },
  });

  const dailyMap = new Map<string, number>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyDaysAgo);
    d.setDate(thirtyDaysAgo.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    dailyMap.set(key, 0);
  }
  for (const b of recentBorrows) {
    const key = b.requestedAt.toISOString().slice(0, 10);
    if (dailyMap.has(key)) dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
  }
  const dailyTrend: DailyBorrowPoint[] = Array.from(dailyMap.entries()).map(([date, count]) => ({
    date,
    count,
  }));

  // Top 10 books
  const topGroups = await db.borrow.groupBy({
    by: ["bookId"],
    _count: { bookId: true },
    orderBy: { _count: { bookId: "desc" } },
    take: 10,
  });
  const topBookIds = topGroups.map((g) => g.bookId);
  const topBookRecords = await db.book.findMany({
    where: { id: { in: topBookIds } },
    select: { id: true, title: true, author: true },
  });
  const bookMap = new Map(topBookRecords.map((b) => [b.id, b]));
  const topBooks: TopBook[] = topGroups.map((g) => ({
    bookId: g.bookId,
    title: bookMap.get(g.bookId)?.title ?? "(已删除)",
    author: bookMap.get(g.bookId)?.author ?? "",
    borrowCount: g._count.bookId,
  }));

  // Category distribution
  const categoryGroups = await db.book.groupBy({
    by: ["category"],
    _count: { category: true },
    where: { category: { not: null } },
  });
  const categoryDistribution: CategoryDistribution[] = categoryGroups
    .map((c) => ({
      category: c.category ?? "未分类",
      count: c._count.category,
    }))
    .sort((a, b) => b.count - a.count);

  // User activity (top 10)
  const userGroups = await db.borrow.groupBy({
    by: ["userId"],
    _count: { userId: true },
    where: { status: { notIn: [BorrowStatus.REJECTED] } },
    orderBy: { _count: { userId: "desc" } },
    take: 10,
  });
  const userIds = userGroups.map((u) => u.userId);
  const userRecords = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, displayName: true },
  });
  const userMap = new Map(userRecords.map((u) => [u.id, u]));
  const userActivity: UserActivity[] = userGroups.map((g) => ({
    userId: g.userId,
    displayName: userMap.get(g.userId)?.displayName ?? "(已注销)",
    borrowCount: g._count.userId,
  }));

  // Status distribution
  const statusGroups = await db.borrow.groupBy({
    by: ["status"],
    _count: { status: true },
  });
  const statusDistribution: StatusDistribution[] = statusGroups.map((s) => ({
    status: s.status,
    label: s.status,
    count: s._count.status,
  }));

  return {
    overview: {
      totalBooks: bookCount,
      totalCopies: totalCopies._sum.totalCopies ?? 0,
      totalBorrows: borrowCount,
      activeBorrows,
      overdueCount,
      overdueRate,
      pendingCount,
      totalUsers: userCount,
      activeStudents: activeStudentCount,
    },
    dailyTrend,
    topBooks,
    categoryDistribution,
    userActivity,
    statusDistribution,
  };
}