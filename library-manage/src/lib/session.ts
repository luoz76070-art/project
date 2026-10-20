import { auth } from "@/lib/auth";
import { Role } from "@/lib/enums";

export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("UNAUTHENTICATED");
  }
  return session;
}

export async function requireAdmin() {
  const session = await requireSession();
  if (session.user.role !== Role.ADMIN) {
    throw new Error("FORBIDDEN");
  }
  return session;
}