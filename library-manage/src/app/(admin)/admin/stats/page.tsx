import { BookOpen, BookMarked, AlertTriangle, Users, BarChart3, Layers } from "lucide-react";
import { getStats } from "@/lib/actions/stats";
import { KpiCard } from "@/components/charts/kpi-card";
import { DailyTrendChart } from "@/components/charts/daily-trend-chart";
import { TopBooksChart } from "@/components/charts/top-books-chart";
import { CategoryPieChart } from "@/components/charts/category-pie-chart";
import { UserActivityChart } from "@/components/charts/user-activity-chart";
import { StatusDistributionChart } from "@/components/charts/status-distribution-chart";

export const dynamic = "force-dynamic";

export default async function AdminStatsPage() {
  const stats = await getStats();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">数据看板</h1>
        <p className="mt-1 text-sm text-muted-foreground">实时统计借阅运营数据，用于演示与研修。</p>
      </div>

      {/* KPI 卡片区 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="总图书数"
          value={stats.overview.totalBooks}
          hint={`共 ${stats.overview.totalCopies} 本（含副本）`}
          icon={<BookOpen className="h-6 w-6" />}
          accent="primary"
        />
        <KpiCard
          label="总借阅数"
          value={stats.overview.totalBorrows}
          hint={`${stats.overview.pendingCount} 条待审批`}
          icon={<BookMarked className="h-6 w-6" />}
          accent="primary"
        />
        <KpiCard
          label="在借中"
          value={stats.overview.activeBorrows}
          hint="已批准 + 借出 + 逾期"
          icon={<BarChart3 className="h-6 w-6" />}
          accent="primary"
        />
        <KpiCard
          label="逾期率"
          value={`${stats.overview.overdueRate}%`}
          hint={`${stats.overview.overdueCount} 条逾期`}
          icon={<AlertTriangle className="h-6 w-6" />}
          accent={stats.overview.overdueCount > 0 ? "destructive" : "muted"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="用户总数"
          value={stats.overview.totalUsers}
          hint={`${stats.overview.activeStudents} 名在读学生`}
          icon={<Users className="h-6 w-6" />}
          accent="muted"
        />
        <KpiCard
          label="分类数"
          value={stats.categoryDistribution.length}
          hint="图书分类维度"
          icon={<Layers className="h-6 w-6" />}
          accent="muted"
        />
      </div>

      {/* 图表区 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DailyTrendChart data={stats.dailyTrend} />
        <StatusDistributionChart data={stats.statusDistribution} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopBooksChart data={stats.topBooks} />
        <CategoryPieChart data={stats.categoryDistribution} />
      </div>

      <div>
        <UserActivityChart data={stats.userActivity} />
      </div>

      <div className="rounded-lg border border-dashed border-border bg-card/40 p-4 text-center text-xs text-muted-foreground">
        数据更新于 {new Date().toLocaleString("zh-CN")} · 仅统计演示数据
      </div>
    </div>
  );
}