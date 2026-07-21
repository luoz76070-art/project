"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { BorrowStatus } from "@/lib/enums";

export async function getAllBorrowsForAdmin(status?: string) {
  await requireAdmin();
  const where: Record<string, unknown> = {};
  if (status && status !== "ALL") where.status = status;
  return db.borrow.findMany({
    where,
    include: { user: true, book: true },
    orderBy: { requestedAt: "desc" },
    take: 200,
  });
}

export async function getReservationQueue(bookId: string) {
  await requireAdmin();
  return db.reservation.findMany({
    where: { bookId, fulfilledAt: null },
    include: { user: true },
    orderBy: { queuePosition: "asc" },
  });
}

export { revalidatePath };