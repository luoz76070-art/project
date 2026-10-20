"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { BookOpen, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
}

export function NavBar({
  items,
  userLabel,
}: {
  items: NavItem[];
  userLabel: string;
}) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 text-foreground">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <BookOpen className="h-5 w-5" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">图书借阅</span>
            <span className="text-[11px] text-muted-foreground">Library Manage</span>
          </div>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          <div className="hidden text-right md:block">
            <div className="text-sm font-medium leading-none">{userLabel}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">已登录</div>
          </div>
          <form
            action={async () => {
              await signOut({ callbackUrl: "/login" });
            }}
          >
            <Button type="submit" variant="outline" size="sm">
              <LogOut className="h-4 w-4" />
              退出
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}