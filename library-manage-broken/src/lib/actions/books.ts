"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, requireAdmin } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const createBookSchema = z.object({
  title: z.string().min(1, "书名不能为空").max(200),
  author: z.string().min(1, "作者不能为空").max(120),
  isbn: z.string().max(40).optional().nullable(),
  category: z.string().max(60).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  coverUrl: z.string().url().optional().nullable(),
  totalCopies: z.number().int().min(1).max(999),
});

const updateBookSchema = createBookSchema.partial().extend({
  id: z.string().min(1),
  isActive: z.boolean().optional(),
});

export async function searchBooks(query?: string, category?: string) {
  await requireSession();

  const where: Record<string, unknown> = { isActive: true };
  if (query) {
    where.OR = [
      { title: { contains: query } },
      { author: { contains: query } },
    ];
  }
  if (category && category !== "ALL") {
    where.category = category;
  }

  return db.book.findMany({
    where,
    orderBy: [{ title: "asc" }],
  });
}

export async function getAllBooksForAdmin() {
  await requireAdmin();
  return db.book.findMany({ orderBy: [{ createdAt: "desc" }] });
}

export async function createBook(input: z.infer<typeof createBookSchema>): Promise<ActionResult> {
  await requireAdmin();
  if (!hasPermission("ADMIN", "book:create")) return { ok: false, error: "无权限" };

  const parsed = createBookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? "参数错误" };

  await db.book.create({
    data: {
      ...parsed.data,
      availableCopies: parsed.data.totalCopies,
    },
  });
  revalidatePath("/admin/books");
  revalidatePath("/books");
  return { ok: true };
}

export async function updateBook(input: z.infer<typeof updateBookSchema>): Promise<ActionResult> {
  await requireAdmin();
  if (!hasPermission("ADMIN", "book:update")) return { ok: false, error: "无权限" };

  const parsed = updateBookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? "参数错误" };

  const existing = await db.book.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return { ok: false, error: "图书不存在" };

  const delta = parsed.data.totalCopies !== undefined
    ? parsed.data.totalCopies - existing.totalCopies
    : 0;

  await db.$transaction(async (tx) => {
    const newAvailable = Math.max(0, existing.availableCopies + delta);
    await tx.book.update({
      where: { id: parsed.data.id },
      data: {
        ...parsed.data,
        availableCopies: newAvailable,
        isbn: parsed.data.isbn ?? undefined,
        category: parsed.data.category ?? undefined,
        description: parsed.data.description ?? undefined,
        coverUrl: parsed.data.coverUrl ?? undefined,
      },
    });
  });

  revalidatePath("/admin/books");
  revalidatePath("/books");
  return { ok: true };
}

export async function deleteBook(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!hasPermission("ADMIN", "book:delete")) return { ok: false, error: "无权限" };

  const active = await db.borrow.count({
    where: { bookId: id, status: { in: ["PENDING", "APPROVED", "BORROWED"] } },
  });
  if (active > 0) return { ok: false, error: `仍有 ${active} 条进行中的借阅，无法删除` };

  await db.book.delete({ where: { id } });
  revalidatePath("/admin/books");
  revalidatePath("/books");
  return { ok: true };
}

export async function restockBook(id: string, delta: number): Promise<ActionResult> {
  await requireAdmin();
  if (!hasPermission("ADMIN", "book:restock")) return { ok: false, error: "无权限" };

  if (!Number.isInteger(delta) || delta === 0) return { ok: false, error: "数量无效" };

  const book = await db.book.findUnique({ where: { id } });
  if (!book) return { ok: false, error: "图书不存在" };

  await db.$transaction(async (tx) => {
    await tx.book.update({
      where: { id },
      data: {
        totalCopies: book.totalCopies + delta,
        availableCopies: Math.max(0, book.availableCopies + delta),
      },
    });
  });

  revalidatePath("/admin/books");
  revalidatePath("/books");
  return { ok: true };
}

export async function toggleBookActive(id: string): Promise<ActionResult> {
  await requireAdmin();
  const book = await db.book.findUnique({ where: { id } });
  if (!book) return { ok: false, error: "图书不存在" };
  await db.book.update({ where: { id }, data: { isActive: !book.isActive } });
  revalidatePath("/admin/books");
  revalidatePath("/books");
  return { ok: true };
}