"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";

export interface TopBookItem {
  bookId: string;
  title: string;
  author: string;
  borrowCount: number;
}

const COLORS = ["#02FF73", "#09ADAA", "#02C95E", "#0A8FA1", "#06B884"];

export function TopBooksChart({ data }: { data: TopBookItem[] }) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">热门图书 TOP 10</CardTitle>
          <CardDescription>借阅次数最多的图书</CardDescription>
        </CardHeader>
        <CardContent className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          暂无数据
        </CardContent>
      </Card>
    );
  }

  const display = data.map((b, i) => ({
    ...b,
    shortTitle: b.title.length > 14 ? b.title.slice(0, 14) + "…" : b.title,
    color: COLORS[i % COLORS.length],
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">热门图书 TOP 10</CardTitle>
        <CardDescription>借阅次数最多的图书</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={display}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E4D9" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "#6B7268" }}
                tickLine={false}
                axisLine={{ stroke: "#E8E4D9" }}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="shortTitle"
                tick={{ fontSize: 11, fill: "#2C3E2E" }}
                tickLine={false}
                axisLine={false}
                width={110}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid #E8E4D9",
                  background: "#FFFFFF",
                  fontSize: 12,
                }}
                formatter={(value) => [`${value} 次`, "借阅次数"]}
                labelFormatter={(label) => `${label}`}
              />
              <Bar dataKey="borrowCount" radius={[0, 6, 6, 0]}>
                {display.map((entry, i) => (
                  <Cell key={entry.bookId} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}