# 讲师版答案手册 — BUGS.md v2（申请借阅流程专项）

> 本文档配套 `BUGS.md`，是讲师的**标准答案 + 讲解要点**。
> **不要把本文档发给学员**。

---

## 总览

| # | Bug | 一句话定位 | 修复 diff 行数 |
|---|---|---|---|
| 1 | 按钮无响应 | JSX 缺 onClick handler | 1 行 |
| 2 | 空白页 | page.tsx `return null` | 1 行（重写 JSX） |
| 3 | 没借阅记录 | `status: "RETURNED"` where 过滤错误 | 1 行 |

**总工作量**：约 95 min（学员 1.5 ~ 2 h，含思考和调试）

---

## 演示前准备

1. 仓库处于"挖坑完成"状态（已运行 `pnpm typecheck` 通过）
2. MySQL 已 seed，`pnpm dev` 启动 OK
3. 用 `student1 / pass1234` 登录测试一遍 3 个 bug 的复现路径
4. 准备 `prisma studio` 命令，方便 Bug #3 时直接看 DB

---

## Bug #1 答案

### 标准修复 diff

```diff
--- a/src/app/(student)/books/book-request-button.tsx
+++ b/src/app/(student)/books/book-request-button.tsx
@@ -50,7 +50,7 @@ export function BookRequestButton({
   }
   if (!showDays) {
     return (
-      <Button size="sm" className="w-full">
+      <Button size="sm" className="w-full" onClick={() => setShowDays(true)}>
         申请借阅
       </Button>
     );
```

### 讲解要点（建议 5 min 讲解）

**引导问题**：
1. 这个按钮渲染了吗？→ 渲染了，外观完全正常
2. 点击有没有反应？→ 完全没反应
3. React 中按钮默认行为是什么？→ 没有任何行为，必须显式绑事件

**关键知识点**：
- React 的 `<button>` 是原生 HTML 元素，**没有内置 onClick 行为**
- 事件 handler 缺失的 3 种表现：
  - 完全没绑 → 按钮像死的（**本次 bug**）
  - 绑了但函数不存在 / 拼写错 → Console 报 "is not a function"
  - 绑了但状态跳转目标错 → 按钮有反应但反应不对（如跳转 404）
- 「action 事件」和「跳转失效」的区别：
  - 没有 action 事件：完全无回调，按钮是死的
  - 跳转失效：有回调但目标错，按钮有反应但反应异常

**举一反三**（可选）：
- 类似的坑：`<a>` 没绑 href、`<form>` 没绑 onSubmit
- 检查方式：React DevTools → 选中组件 → 看 props.onClick 是否存在

---

## Bug #2 答案

### 标准修复 diff

`src/app/(student)/request/page.tsx` 从 31 行（仅 `return null;`）恢复成完整 144 行的 JSX 渲染（包含图书列表 + 我的借阅历史 + 我的排队 三个 section）。

```diff
--- a/src/app/(student)/request/page.tsx
+++ b/src/app/(student)/request/page.tsx
@@ -1,9 +1,9 @@
-import { db } from "@/lib/db";
-import { auth } from "@/lib/auth";
-import { redirect } from "next/navigation";
+import Link from "next/link";
+import { db } from "@/lib/db";
+import { auth } from "@/lib/auth";
+import { redirect } from "next/navigation";
+import { Card, CardContent } from "@/components/ui/card";
+import { Badge } from "@/components/ui/badge";
+import { BorrowStatusBadge } from "@/components/borrow-status-badge";
+import { formatDate } from "@/lib/utils";
+import { BookOpen, Clock } from "lucide-react";

 export default async function RequestPage() {
   const session = await auth();
@@ -13,7 +13,7 @@
   const books = await db.book.findMany({
     where: { isActive: true },
     orderBy: { title: "asc" },
   });

   const myRequests = await db.borrow.findMany({
     where: {
       userId: session.user.id,
-      status: "RETURNED",
+      status: { in: ["PENDING", "APPROVED", "BORROWED", "REJECTED"] },
     },
     include: { book: true },
@@ -28,7 +28,115 @@
     include: { book: true },
     orderBy: { createdAt: "desc" },
   });

-  return null;
+  return (
+    <div className="space-y-8">
+      <div>
+        <h1 className="text-2xl font-semibold tracking-tight">申请借阅</h1>
+        ...（完整 JSX，144 行）
+    </div>
+  );
 }
```

> 教学现场：让学员恢复 JSX 时，不必强求逐字还原，能编译 + 能渲染就行。

### 讲解要点（建议 8 min 讲解）

**引导问题**：
1. 这个页面有报错吗？→ 没有
2. Network 状态码是多少？→ 200
3. 那为什么空白？→ 组件返回 null，React 不渲染任何东西

**关键知识点**：
- Next.js App Router 下，blank page 有 4 种典型成因：
  - **return null / 空 fragment**（**本次 bug**）
  - 数据查询抛错 → 触发 error.tsx（不是空白）
  - 整个 JSX 被注释掉 → 看 source 一眼能看出
  - 路由不存在 → 触发 not-found.tsx
- 「空白」和「报错」是两类完全不同的故障：
  - 空白 = 逻辑执行了但没渲染
  - 报错 = 逻辑没执行完就被中断
- 调试流程：先 Network 看 RSC payload → 再看 source 是否 return null → 最后看 data fetch 是否抛错

**举一反三**（可选）：
- 同样的坑：在 `if (loading) return null` 时漏写 `else` 分支
- 防御性写法：`if (!data) return <Skeleton />` 而不是 `return null`

---

## Bug #3 答案

### 标准修复 diff

```diff
--- a/src/app/(student)/request/page.tsx
+++ b/src/app/(student)/request/page.tsx
@@ -14,7 +14,7 @@
   const myRequests = await db.borrow.findMany({
     where: {
       userId: session.user.id,
-      status: "RETURNED",
+      status: { in: ["PENDING", "APPROVED", "BORROWED", "REJECTED"] },
     },
     include: { book: true },
     orderBy: { requestedAt: "desc" },
```

### 讲解要点（建议 12 min 讲解，本次重点）

**引导问题**：
1. `/my-borrows` 能看到数据，但 `/request` 看不到——为什么？→ 两个 page 用了不同查询
2. `/request` 的查询真的查不到吗？→ 用 prisma studio 直接查 DB 看
3. 数据存在但查不到，问题在哪？→ **where 条件过滤掉了**

**关键知识点**：

**「数据库没回显」vs「没写回显功能」二分法**：

| 类型 | 表现 | 调试手段 |
|---|---|---|
| 数据库没回显 | DB 里有数据，但查询结果为空 | 用 prisma studio / SQL 直接查 DB |
| 没写回显功能 | DB 里有数据，查询也返回了，但 UI 没渲染 | 看 page.tsx 是否有 `.map` 渲染逻辑 |

**本次 bug 属于「数据库没回显」**：
- `status: "RETURNED"` 是个**字面量过滤**，只匹配 status 字段等于字符串 "RETURNED" 的记录
- 但借阅生命周期初始是 `PENDING`（见 `requestBorrow` in `src/lib/actions/borrows.ts:85`），永远不会是 "RETURNED"
- 所以查询永远返回空数组，UI 渲染"暂无申请记录"

**与 `/my-borrows` 的对比**：
- `/my-borrows`（`src/lib/actions/users.ts` 的 `getMyBorrows()`）用了正确的 status 集合
- `/request`（`src/app/(student)/request/page.tsx:17`）的 status 被改成 `"RETURNED"`
- 同一份数据在不同页面的差异 = bug 定位的金标准

**Prisma enum 过滤的两个正确写法**：

```ts
// ✅ 写法 1：in 数组
status: { in: ["PENDING", "APPROVED", "BORROWED", "REJECTED"] }

// ✅ 写法 2：not 排除
status: { not: "RETURNED" }

// ❌ 错误写法（本次 bug）
status: "RETURNED"  // 字面量匹配，永远查不到 PENDING
```

**举一反三**（可选）：
- 类似的坑：把 `userId: session.user.id` 写成 `userId: "current"` 字面量
- 类似的坑：把 `bookId: parsed.data.bookId` 写成 `bookId: "all"`
- Prisma 中字符串字面量和 `{ equals: "..." }` / `{ in: [...] }` / `{ not: "..." }` 的区别

---

## 演示流程建议（讲师用）

### 演示时长：约 5 min 演示 + 让学员操作 90 min

1. 用 `student1` 登录 → 介绍三个学生端页面（30 s）
2. 在 `/books` 点「申请借阅」→ **演示 Bug #1**（30 s）
3. 让学员用 opencode 分析 → 5 min 思考
4. 学员回答后揭晓答案 → 演示修复（1 min）
5. 进入 `/request` → **演示 Bug #2**（30 s）
6. 让学员分析 → 8 min 思考
7. 学员回答后揭晓 → 演示修复（1 min）
8. 申请一本书 → 回 `/request` → **演示 Bug #3**（30 s）
9. 让学员分析 → 12 min 思考
10. 揭晓答案 → 演示 prisma studio 验证数据（1 min）
11. 总结三类调试思维：UI 层 / 渲染层 / 数据层（2 min）

### 备用演示方案（如果学员卡住）

| 卡住点 | 提示 |
|---|---|
| Bug #1 找不出 | 引导看 React DevTools 的 props；提示"事件 handler 在哪" |
| Bug #2 找不出 | 引导看 page.tsx 末尾的 `return` 语句；提示"页面渲染了什么" |
| Bug #3 找不出 | 引导对比 `/my-borrows` 和 `/request` 的 query；提示"prisma studio 直接看 DB" |

---

## 评分建议（可选）

| 维度 | 满分 | 评分点 |
|---|---|---|
| Bug 定位速度 | 30 | 每个 bug 限时内找到 |
| 修复正确性 | 30 | 是否只改必要代码，没引入新 bug |
| 解释清晰度 | 20 | 能否说清「为什么这个改动能修复」 |
| 调试方法论 | 20 | 是否用 opencode 读源码 / DevTools / DB 多角度验证 |

---

## 课后思考题（发给学员）

1. Bug #1 中，如果我们改的不是 onClick 而是 `setShowDays(true)` 的实现（例如改成 `setShowDays(false)`），按钮点击会有什么不同表现？
2. Bug #2 中，如果把 `return null` 改成 `if (books.length === 0) return null;`，会出现什么场景问题？
3. Bug #3 中，除了改 where 条件，还有什么修复方式？（提示：想想 `revalidatePath`）
4. 这 3 个 bug 分别属于"前端 / 后端 / 数据库"哪一层？如果再加一个 bug，你会选哪一层？