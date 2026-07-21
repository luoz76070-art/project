import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Role } from "@/lib/enums";

export default async function RootPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role === Role.ADMIN) redirect("/admin/books");
  redirect("/books");
}