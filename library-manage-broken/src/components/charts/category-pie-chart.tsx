"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip } from "recharts";

export interface CategoryItem {
  category: string;
  count: number;
}

const COLORS = ["#02FF73", "#09ADAA", "#0A8FA1", "#06B884", "#7AD6A8", "#5BC0BE", "#A8E6CF", "#88D8B0"];

export function CategoryPieChart({ data }: { data: CategoryItem[] }) {
  const total = data.reduce((acc, d) => acc + d.count, 0);

  if (total === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">分类分布</CardTitle>
          <CardDescription>各分类图书数</CardDescription>
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
        <CardTitle className="text-base">分类分布</CardTitle>
        <CardDescription>各分类图书数（共 {total} 本）</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="count"
                nameKey="category"
                innerRadius={48}
                outerRadius={84}
                paddingAngle={2}
                strokeWidth={0}
              >
                {data.map((entry, i) => (
                  <Cell key={entry.category} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid #E8E4D9",
                  background: "#FFFFFF",
                  fontSize: 12,
                }}
                formatter={(value, name) => [`${value} 本`, String(name)]}
              />
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: 11, color: "#6B7268" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}