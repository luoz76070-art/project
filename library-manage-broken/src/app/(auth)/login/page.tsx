import { redirect } from "next/navigation";
import { BookOpen } from "lucide-react";
import { auth } from "@/lib/auth";
import { Role } from "@/lib/enums";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) {
    if (session.user.role === Role.ADMIN) redirect("/admin/books");
    redirect("/books");
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/20">
            <BookOpen className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">图书借阅管理</h1>
          <p className="text-sm text-muted-foreground">登录以继续 · Library Manage</p>
        </div>
        <LoginForm />
        <div className="mt-8 w-full rounded-xl border border-border bg-card/60 p-4 text-xs text-muted-foreground">
          <div className="mb-2 font-medium text-foreground">演示账号</div>
          <div className="space-y-1">
            <div>
              管理员：<span className="font-mono">admin / admin1234</span>
            </div>
            <div>
              学生：<span className="font-mono">student1 ~ student5 / pass1234</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}