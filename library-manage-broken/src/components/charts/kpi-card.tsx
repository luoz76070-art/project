"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  trend?: "up" | "down" | "neutral";
  accent?: "primary" | "warning" | "destructive" | "muted";
  icon?: React.ReactNode;
}

const ACCENT_CLASSES = {
  primary: "bg-primary/15 text-primary-foreground",
  warning: "bg-[#FDF4DC] text-[#8A6A0F]",
  destructive: "bg-destructive/15 text-destructive",
  muted: "bg-muted text-muted-foreground",
};

export function KpiCard({ label, value, hint, trend, accent = "primary", icon }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
          {hint && (
            <div
              className={cn(
                "mt-1 text-xs",
                trend === "up" && "text-[#1A5E3A]",
                trend === "down" && "text-destructive",
                trend === "neutral" && "text-muted-foreground"
              )}
            >
              {hint}
            </div>
          )}
        </div>
        {icon && (
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-xl",
              ACCENT_CLASSES[accent]
            )}
          >
            {icon}
          </div>
        )}
      </CardContent>
    </Card>
  );
}