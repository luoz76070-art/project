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

export interface StatusItem {
  status: string;
  label: string;
  count: number;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#FDF4DC",
  APPROVED: "#B5E8DC",
  BORROWED: "#02FF73",
  RETURNED: "#7AD6A8",
  OVERDUE: "#D97757",
  REJECTED: "#D9D4C5",
};

const STATUS_BAR_COLORS: Record<string, string> = {
  PENDING: "#D4A017",
  APPROVED: "#09ADAA",
  BORROWED: "#02A858",
  RETURNED: "#1A5E3A",
  OVERDUE: "#D97757",
  REJECTED: "#9CA39A",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "待审批",
  APPROVED: "已批准",
  BORROWED: "已借出",
  RETURNED: "已归还",
  OVERDUE: "已逾期",
  REJECTED: "已拒绝",
};

export function StatusDistributionChart({ data }: { data: StatusItem[] }) {
  const mapped = data.map((d) => ({
    ...d,
    label: STATUS_LABEL[d.status] ?? d.status,
    color: STATUS_BAR_COLORS[d.status] ?? "#9CA39A",
  }));

  if (mapped.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">借阅状态分布</CardTitle>
          <CardDescription>所有借阅记录按状态统计</CardDescription>
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
        <CardTitle className="text-base">借阅状态分布</CardTitle>
        <CardDescription>所有借阅记录按状态统计</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={mapped} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E4D9" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#6B7268" }}
                tickLine={false}
                axisLine={{ stroke: "#E8E4D9" }}
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
                formatter={(value) => [`${value} 条`, "记录数"]}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {mapped.map((entry) => (
                  <Cell key={entry.status} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}