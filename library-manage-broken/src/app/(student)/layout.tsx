import { redirect } from "next/navigation";
import { NavBar } from "@/components/nav-bar";
import { auth } from "@/lib/auth";
import { Role } from "@/lib/enums";

const STUDENT_NAV = [
  { href: "/books", label: "图书查询" },
  { href: "/request", label: "申请借阅" },
  { href: "/my-borrows", label: "我的借阅" },
];

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== Role.STUDENT && session.user.role !== Role.ADMIN) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-background">
      <NavBar items={STUDENT_NAV} userLabel={session.user.name ?? session.user.username} />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}