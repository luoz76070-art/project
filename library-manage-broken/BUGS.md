# BUGS.md — 学员上机作业

本目录的 `library-manage-broken` 是**故意留有 3 个 bug** 的练习项目。修复这些 bug 的总工作量约为 **3 小时**（按简单 → 中等 → 中等难度排序）。

| # | 类型 | 难度 | 估时 |
|---|---|---|---|
| 1 | 前端 | 简单 | 30 min |
| 2 | 后端 | 中等 | 45 min |
| 3 | 越权 | 中等 | 1 h 45 min |

每个 bug 都给出：
- **复现步骤**（你可以照着做）
- **期望 vs 实际**
- **修复方向**（同时也是给 AI 的提示词）

---

## 准备工作

1. 已有 MySQL 8.0 数据库（参见 [`docs/DATABASE.md`](./docs/DATABASE.md)）
2. `cp .env.example .env` → 修改 `DATABASE_URL`
3. `pnpm install --prefer-offline`
4. `pnpm db:push && pnpm db:seed`
5. `pnpm dev` → 浏览器打开 `http://localhost:3000`

演示账号：

| 角色 | 用户名 | 密码 |
|---|---|---|
| 管理员 | `admin` | `admin1234` |
| 学生 | `student1` ~ `student5` | `pass1234` |

> ⚠️ 种子里包含一本分类为"**数学**"的《数学之美》，这是 Bug #1 的触发条件。

---

## Bug #1：分类筛选下拉框找不到新增分类

**类型**：前端 / 数据流不一致
**预估修复时间**：30 min

### 现象描述

管理员新增了一本分类为"数学"的图书《数学之美》，但学生在前台"图书查询"页面 `/books` 的"分类"筛选下拉框里看不到"数学"选项，导致这本新书无法通过分类筛选找到。

### 复现步骤

1. 启动项目（按上文"准备工作"）2. 浏览器打开 `http://localhost:3000`，用 `admin` 登录
3. 进入"图书管理" `/admin/books` → 看到种子里有一本**分类为"数学"**的《数学之美》
4. 退出 → 用 `student1` 登录 → 进入"图书查询" `/books`
5. 搜索框输入"数学" → 能找到《数学之美》→ 证明书确实存在
6. 看"分类"筛选下拉框 → **没有"数学"这一项** → 只有"文学/计算机/历史/哲学/艺术/科学" 6 个固定值
7. 尝试按"数学"筛选 → 无法操作（因为下拉里没有）

### 期望 vs 实际

- **期望**：下拉框显示数据库里所有实际存在的分类（含"数学"）
- **实际**：下拉框只有 6 个硬编码的固定值

### 修复方向（给 AI 的提示词）

```
学生端 /books 页面的分类筛选 <select> 渲染了一个写死的 6 项数组
["文学", "计算机", "历史", "哲学", "艺术", "科学"]，
但同一组件内已经 db.book.findMany({ distinct: ["category"] }) 算出了真实的 categoryList，
却没用上。请把 <select> 改成渲染 categoryList 而非硬编码数组。
```

**核心改动**：把第 135 行附近的硬编码数组替换为 `{categoryList.map((c) => <option key={c} value={c}>{c}</option>)}`。

**附加思考**：
- 这种"算出来又没用"的代码叫什么？（死代码 / shadow variable）
- 还有哪些地方可能存在类似问题？

---

## Bug #2：30 天借阅趋势图日期错位 8 小时

**类型**：后端 / 时区一致性
**预估修复时间**：45 min

### 现象描述

管理员在凌晨时间（特别是 0:00 ~ 8:00 之间）提交借阅申请后，去"数据看板" `/admin/stats` 看"30 天借阅趋势"图，会发现这个借阅被错误地归到了"昨天"的柱子上（中国时区下相差 8 小时）。

### 复现步骤

1. 用 `student1` 登录
2. 把系统时间改到凌晨时段（例如 `2026-08-19` 中国时间 02:00；本地时间可通过 `sudo date -s "2026-08-19 02:00:00"` 或关闭 NTP 同步手动调）
3. 在 `/books` 借一本书 → 产生一条 PENDING 借阅
4. 退出 → 用 `admin` 登录 → 进入"数据看板" `/admin/stats`
5. 看"30 天借阅趋势"折线图
6. **期望**：今天（`2026-08-19`）那根柱子 +1
7. **实际**：昨天（`2026-08-18`）那根柱子 +1

> 提示：如果改系统时间不方便，可以用 SQL 直接插入一条 `requestedAt = '2026-08-19 01:30:00'`（北京凌晨）的 borrow 记录来模拟。

### 期望 vs 实际

- **期望**：借阅归到本地时区的"今天"
- **实际**：借阅归到了 UTC 时区的"今天"，相当于本地时区"昨天"

### 修复方向（给 AI 的提示词）

```
src/lib/actions/stats.ts 的 30 天趋势计算里：
- dailyMap 的 key 用 setHours/setDate 构造本地 Date，但 toISOString().slice(0,10) 是 UTC 切片
- borrow.requestedAt.toISOString().slice(0,10) 也是 UTC 切片

两边时区不一致：中国时区下相差 8 小时。
请统一用 date-fns 的 format(d, 'yyyy-MM-dd') 处理所有日期 key（默认本地时区）。
```

**核心改动**：把 `stats.ts:95` 和 `stats.ts:99` 两处 `xxx.toISOString().slice(0,10)` 改为 `format(xxx, 'yyyy-MM-dd')`（从 `date-fns` 导入 `format`）。

**附加思考**：
- 项目里其他日期展示是否有同样的时区问题？
- 修复时为何不推荐统一改用 UTC？（答：用户视角下"今天"是本地时间，不是 UTC）

---

## Bug #3：学生可直接访问 `/admin/*` 页面

**类型**：越权 / 路径守卫缺失
**预估修复时间**：1 h 45 min

### 现象描述

学生登录后，在浏览器地址栏直接输入 `/admin/books`（或 `/admin/users`、`/admin/stats`、`/admin/borrows`），**不会被踢回 `/books`，而是直接看到管理页面**。这意味着所有借阅数据、用户信息、库存数据都被泄露给学生角色。

### 复现步骤

1. 用 `student1` 登录
2. 浏览器地址栏直接输入 `http://localhost:3000/admin/books` 回车
3. **期望**：被重定向到 `/books`
4. **实际**：直接看到所有图书列表（含已下架的、含所有元数据）
5. 进一步测试：
   - `/admin/users` → 看到所有用户（含 admin 的）
   - `/admin/stats` → 看到借阅趋势图（所有用户的数据）
   - `/admin/borrows` → 看到所有借阅记录

### 期望 vs 实际

- **期望**：非管理员访问 `/admin/*` 被拦截
- **实际**：直接渲染管理页面（数据泄露）

### 关键观察（修复前先想清楚）

**单点修复不够**：

- **只修 `src/middleware.ts`**：middleware 不再拦截 `/admin`，但 admin layout 仍会重定向到 `/books` → 学生被踢回 → 越权失败
- **只修 `src/app/(admin)/layout.tsx`**：admin layout 不重定向，但 middleware 仍拦截 `/admin` → 学生被踢回 → 越权失败
- **两处都改**：学生直接看到管理页面 → 越权成功

**教学点**：为什么单点修复不够？—— 这就是"**纵深防御**"（Defense in Depth）的核心思想：每一层都不能信任上一层。

### 修复方向（给 AI 的提示词）

```
路径守卫失效：student 登录后直接访问 /admin/books 能看到所有图书数据。

请：
1. 阅读 src/middleware.ts 和 src/app/(admin)/layout.tsx，理解 Next.js 的双层守卫机制；
2. 解释为什么只修一层（middleware 或 layout）不够，必须两层都修；
3. 把两处都改回原状（middleware 检查 "/admin"，layout 检查 role === ADMIN）；
4. 修复后用 student 账号验证：访问 /admin/books 应该被踢回 /books；
5. 用 admin 账号验证：访问 /admin/books 应该正常显示管理页面。
```

**核心改动**：

| 文件 | 改动 |
|---|---|
| `src/middleware.ts:31` | `"/admin-secret"` 改回 `"/admin"` |
| `src/app/(admin)/layout.tsx:17` | 恢复 `if (session.user.role !== Role.ADMIN) redirect("/books");` |

**验证清单**（修复后必做）：

- [ ] student 访问 `/admin/books` → 跳 `/books`
- [ ] student 访问 `/admin/users` → 跳 `/books`
- [ ] student 访问 `/admin/stats` → 跳 `/books`
- [ ] student 访问 `/admin/borrows` → 跳 `/books`
- [ ] admin 访问以上 4 个路径 → 正常显示

---

## 提交方式

修复完 3 个 bug 后，建议：

```bash
git add -A
git commit -m "fix: 修复 BUGS.md 中的 3 个 bug"
```

如果遇到困难：

1. 用 BUGS.md 里给出的提示词喂给 AI 助手
2. 用 `pnpm typecheck` 验证 TypeScript 编译
3. 用 `pnpm dev` 启动后照"复现步骤"反向验证

---

**祝你练习愉快 🚀**