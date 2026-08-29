import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

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
      status: "RETURNED",
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

  return null;
}