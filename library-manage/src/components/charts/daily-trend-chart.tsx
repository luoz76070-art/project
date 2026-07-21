"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { format, parseISO } from "date-fns";

export interface DailyPoint {
  date: string;
  count: number;
}

export function DailyTrendChart({ data }: { data: DailyPoint[] }) {
  const formatted = data.map((d) => ({
    ...d,
    label: format(parseISO(d.date), "MM/dd"),
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">借阅趋势</CardTitle>
        <CardDescription>最近 30 天每日借阅申请数</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={formatted} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#02FF73" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#02FF73" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E4D9" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#6B7268" }}
                tickLine={false}
                axisLine={{ stroke: "#E8E4D9" }}
                interval="preserveStartEnd"
                minTickGap={32}
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
                labelStyle={{ color: "#6B7268", marginBottom: 4 }}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#02A858"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#02FF73", stroke: "#02A858", strokeWidth: 1.5 }}
                activeDot={{ r: 5, fill: "#02A858" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}