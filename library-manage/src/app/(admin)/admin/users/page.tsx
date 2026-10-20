import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserActions } from "./user-actions";
import { AddUserButton } from "./add-user-button";
import { RoleLabel } from "@/lib/enums";
import { formatDate } from "@/lib/utils";

export default async function AdminUsersPage() {
  const users = await db.user.findMany({ orderBy: [{ createdAt: "desc" }] });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">用户管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">查看、新增用户，调整角色与状态。</p>
        </div>
        <AddUserButton />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="h-11 px-4 text-left font-medium">用户</th>
                  <th className="h-11 px-4 text-left font-medium">角色</th>
                  <th className="h-11 px-4 text-left font-medium">状态</th>
                  <th className="h-11 px-4 text-left font-medium">注册时间</th>
                  <th className="h-11 px-4 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.displayName}</div>
                      <div className="text-xs text-muted-foreground">@{u.username}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={u.role === "ADMIN" ? "secondary" : "muted"}>
                        {RoleLabel[u.role as keyof typeof RoleLabel] ?? u.role}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {u.isActive ? (
                        <Badge variant="success">正常</Badge>
                      ) : (
                        <Badge variant="muted">已停用</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(u.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <UserActions
                        userId={u.id}
                        role={u.role}
                        isActive={u.isActive}
                        username={u.username}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}