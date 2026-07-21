"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, requireAdmin } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { BorrowStatus, Role } from "@/lib/enums";

const requestSchema = z.object({
  bookId: z.string().min(1),
  requestedDays: z.number().int().min(1).max(180),
});

export async function requestBorrow(input: z.infer<typeof requestSchema>) {
  const session = await requireSession();
  if (!hasPermission(session.user.role, "borrow:request")) {
    return { ok: false as const, error: "无权限" };
  }
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "参数错误" };

  const book = await db.book.findUnique({ where: { id: parsed.data.bookId } });
  if (!book || !book.isActive) return { ok: false as const, error: "图书不存在或已下架" };

  const userId = session.user.id;

  const dup = await db.borrow.findFirst({
    where: {
      userId,
      bookId: parsed.data.bookId,
      status: { in: [BorrowStatus.PENDING, BorrowStatus.APPROVED, BorrowStatus.BORROWED] },
    },
  });
  if (dup) return { ok: false as const, error: "你已存在该书的进行中借阅" };

  const queued = await db.reservation.findFirst({
    where: { userId, bookId: parsed.data.bookId, fulfilledAt: null },
  });
  if (queued) return { ok: false as const, error: "你已在该书的排队队列中" };

  const result = await db.$transaction(async (tx) => {
    if (book.availableCopies > 0) {
      const borrow = await tx.borrow.create({
        data: {
          userId,
          bookId: book.id,
          status: BorrowStatus.PENDING,
          requestedDays: parsed.data.requestedDays,
        },
      });
      await tx.book.update({
        where: { id: book.id },
        data: { availableCopies: book.availableCopies - 1 },
      });
      return { kind: "BORROWED" as const, borrow };
    }
    const lastPos = await tx.reservation.findFirst({
      where: { bookId: book.id, fulfilledAt: null },
      orderBy: { queuePosition: "desc" },
    });
    const nextPos = (lastPos?.queuePosition ?? 0) + 1;
    const reservation = await tx.reservation.create({
      data: { userId, bookId: book.id, queuePosition: nextPos },
    });
    return { kind: "QUEUED" as const, reservation };
  });

  revalidatePath("/books");
  revalidatePath("/request");
  revalidatePath("/my-borrows");
  revalidatePath("/admin/borrows");

  if (result.kind === "BORROWED") {
    return { ok: true as const, kind: "BORROWED" as const, message: "申请已提交，等待管理员审批" };
  }
  return {
    ok: true as const,
    kind: "QUEUED" as const,
    queuePosition: result.reservation.queuePosition,
    message: `已加入排队队列，当前第 ${result.reservation.queuePosition} 位`,
  };
}

export async function returnBorrow(borrowId: string) {
  const session = await requireSession();

  const borrow = await db.borrow.findUnique({
    where: { id: borrowId },
    include: { book: true },
  });
  if (!borrow) return { ok: false as const, error: "记录不存在" };

  const isOwn = borrow.userId === session.user.id;
  const canAny = hasPermission(session.user.role, "borrow:return_any");
  const canOwn = hasPermission(session.user.role, "borrow:return_own");
  if (!isOwn || !canOwn) {
    if (!canAny) return { ok: false as const, error: "无权限" };
  }

  if (![BorrowStatus.BORROWED, BorrowStatus.APPROVED, BorrowStatus.OVERDUE].includes(borrow.status as never)) {
    return { ok: false as const, error: "当前状态不可归还" };
  }

  await db.$transaction(async (tx) => {
    await tx.borrow.update({
      where: { id: borrowId },
      data: { status: BorrowStatus.RETURNED, returnedAt: new Date() },
    });

    const book = await tx.book.findUnique({ where: { id: borrow.bookId } });
    if (!book) return;

    const next = await tx.reservation.findFirst({
      where: { bookId: borrow.bookId, fulfilledAt: null },
      orderBy: { queuePosition: "asc" },
    });

    if (next) {
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + 30);
      await tx.borrow.create({
        data: {
          userId: next.userId,
          bookId: borrow.bookId,
          status: BorrowStatus.PENDING,
          requestedDays: 30,
          approvedAt: new Date(),
          dueAt,
        },
      });
      await tx.reservation.update({
        where: { id: next.id },
        data: { fulfilledAt: new Date() },
      });
    } else {
      await tx.book.update({
        where: { id: borrow.bookId },
        data: { availableCopies: Math.min(book.totalCopies, book.availableCopies + 1) },
      });
    }
  });

  revalidatePath("/my-borrows");
  revalidatePath("/books");
  revalidatePath("/admin/borrows");
  return { ok: true as const, message: "已归还" };
}

export async function approveBorrow(borrowId: string) {
  await requireAdmin();
  if (!hasPermission(Role.ADMIN, "borrow:approve")) return { ok: false as const, error: "无权限" };

  const borrow = await db.borrow.findUnique({ where: { id: borrowId } });
  if (!borrow) return { ok: false as const, error: "记录不存在" };
  if (borrow.status !== BorrowStatus.PENDING) return { ok: false as const, error: "状态不允许" };

  await db.borrow.update({
    where: { id: borrowId },
    data: { status: BorrowStatus.APPROVED, approvedAt: new Date() },
  });

  revalidatePath("/admin/borrows");
  revalidatePath("/my-borrows");
  return { ok: true as const, message: "已批准" };
}

export async function rejectBorrow(borrowId: string, reason: string) {
  await requireAdmin();
  if (!hasPermission(Role.ADMIN, "borrow:reject")) return { ok: false as const, error: "无权限" };

  const borrow = await db.borrow.findUnique({
    where: { id: borrowId },
    include: { book: true },
  });
  if (!borrow) return { ok: false as const, error: "记录不存在" };
  if (borrow.status !== BorrowStatus.PENDING) return { ok: false as const, error: "状态不允许" };

  await db.$transaction(async (tx) => {
    await tx.borrow.update({
      where: { id: borrowId },
      data: { status: BorrowStatus.REJECTED, rejectReason: reason, returnedAt: new Date() },
    });
    if (borrow.book) {
      await tx.book.update({
        where: { id: borrow.bookId },
        data: { availableCopies: Math.min(borrow.book.totalCopies, borrow.book.availableCopies + 1) },
      });
    }
  });

  revalidatePath("/admin/borrows");
  revalidatePath("/my-borrows");
  revalidatePath("/books");
  return { ok: true as const, message: "已拒绝" };
}

export async function markAsBorrowed(borrowId: string) {
  await requireAdmin();
  if (!hasPermission(Role.ADMIN, "borrow:mark_borrowed")) return { ok: false as const, error: "无权限" };

  const borrow = await db.borrow.findUnique({ where: { id: borrowId } });
  if (!borrow) return { ok: false as const, error: "记录不存在" };
  if (borrow.status !== BorrowStatus.APPROVED) return { ok: false as const, error: "需先批准" };

  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + borrow.requestedDays);

  await db.borrow.update({
    where: { id: borrowId },
    data: { status: BorrowStatus.BORROWED, borrowedAt: new Date(), dueAt },
  });

  revalidatePath("/admin/borrows");
  revalidatePath("/my-borrows");
  return { ok: true as const, message: "已标记为借出" };
}