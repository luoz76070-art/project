import { redirect } from "next/navigation";
import { NavBar } from "@/components/nav-bar";
import { auth } from "@/lib/auth";
import { Role } from "@/lib/enums";

const ADMIN_NAV = [
  { href: "/admin/books", label: "图书管理" },
  { href: "/admin/borrows", label: "借阅审批" },
  { href: "/admin/stats", label: "数据看板" },
  { href: "/admin/users", label: "用户管理" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen bg-background">
      <NavBar items={ADMIN_NAV} userLabel={session.user.name ?? session.user.username} />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}