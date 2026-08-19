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
} from "recharts";

export interface UserActivityItem {
  userId: string;
  displayName: string;
  borrowCount: number;
}

export function UserActivityChart({ data }: { data: UserActivityItem[] }) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">用户活跃度 TOP 10</CardTitle>
          <CardDescription>借阅次数最多的学生</CardDescription>
        </CardHeader>
        <CardContent className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          暂无数据
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">用户活跃度 TOP 10</CardTitle>
        <CardDescription>借阅次数最多的学生</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E4D9" />
              <XAxis
                dataKey="displayName"
                tick={{ fontSize: 11, fill: "#6B7268" }}
                tickLine={false}
                axisLine={{ stroke: "#E8E4D9" }}
                interval={0}
                angle={-20}
                textAnchor="end"
                height={50}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#6B7268" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid #E8E4D9",
                  background: "#FFFFFF",
                  fontSize: 12,
                }}
                formatter={(value) => [`${value} 次`, "借阅次数"]}
              />
              <Bar dataKey="borrowCount" fill="#09ADAA" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}