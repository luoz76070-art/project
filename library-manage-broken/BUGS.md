# BUGS.md — 学员上机作业（v2：申请借阅流程专项）

本目录的 `library-manage-broken` 是**故意留有 3 个 bug** 的练习项目。3 个 bug 全部位于"学生端申请借阅"主路径上，按渐进式分析顺序暴露：

| # | 类型 | 难度 | 估时 | 核心调试思维 |
|---|---|---|---|---|
| 1 | 前端 / 事件缺失 | 简单 | 20 min | onClick 事件 vs router.push |
| 2 | 渲染层 | 中等 | 30 min | return null vs 数据抛错 vs JSX 缺失 |
| 3 | 数据层 | 中等 | 45 min | DB 回显 vs UI 回显 |

每个 bug 都给出：
- **复现步骤**（你可以照着做）
- **期望 vs 实际**
- **关键观察**（修复前先想清楚）
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

---

## 教学流程（必读）

1. 用 `student1` 登录，熟悉 `/books`、`/request`、`/my-borrows` 三个学生端页面
2. 在 `/books` 点任意一本书的「申请借阅」按钮 → **发现按钮无响应** → 进入 Bug #1
3. 修复 Bug #1 → 按钮工作后，进入 `/request` → **页面是空白** → 进入 Bug #2
4. 修复 Bug #2 → 页面骨架恢复 → 在 `/books` 借一本书 → 回到 `/request` → **「我的借阅历史」为空** → 进入 Bug #3
5. 修复 Bug #3 → 「我的借阅历史」出现该借阅 → 练习完成

---

## Bug #1：「申请借阅」按钮点击无响应

**类型**：前端 / React 事件缺失
**预估修复时间**：20 min

### 现象描述

学生在 `/books` 页面点击任意图书卡片底部的「申请借阅」按钮，按钮**外观完全正常**（绿色 + 文字清晰），点击后**没有任何视觉反馈**——既不弹出借阅天数选择器，也不跳转。Console 无报错。

### 复现步骤

1. 启动项目（按上文"准备工作"）
2. 浏览器打开 `http://localhost:3000`，用 `student1` 登录
3. 进入「图书查询」`/books`
4. 在任意一本**有库存**（availableCopies > 0）的图书卡片上点击「申请借阅」按钮
5. **期望**：按钮变成一个天数下拉选择器（7/14/30/60 天）+「确认」按钮
6. **实际**：按钮无任何反应，页面其他元素也没有变化

> ⚠️ 如果点击的是**无库存**（availableCopies = 0）图书的「加入排队」按钮，那个按钮是正常的——bug 只在有库存图书的「申请借阅」按钮上。

### 期望 vs 实际

- **期望**：点击「申请借阅」后，按钮变为天数下拉选择器（7 / 14 / 30 / 60 天）+「确认」按钮
- **实际**：按钮外观无任何变化，DevTools Console 也没有报错

### 关键观察（修复前先想清楚）

打开浏览器 DevTools：
- 选中按钮 → 看 React DevTools 上 Button 组件的 props
- 「onClick」是否存在？事件 handler 是什么？
- 这个按钮点击时，React 是否会触发任何回调？

调试方向二选一：
- **A. 没有对应的 action 事件**：按钮渲染了，但根本没绑 onClick——React 中按钮默认无行为
- **B. 该按钮跳转失效**：按钮绑了 onClick，但回调里的 `setShowDays(true)`、`router.push(...)` 或 `href` 被破坏——点击有反应，但反应不对

### 修复方向（给 AI 的提示词）

```
/books 页面的"申请借阅"按钮点击没有反应。
请检查 src/app/(student)/books/book-request-button.tsx 中的 Button 组件，
分析是没有 onClick 事件，还是跳转逻辑被破坏。
请只补回缺失的事件处理器，不要改其他逻辑。
```

**核心改动**：
- `src/app/(student)/books/book-request-button.tsx:53` 给"申请借阅"按钮补回 `onClick={() => setShowDays(true)}`

**验证清单**（修复后必做）：
- [ ] 点有库存图书的"申请借阅" → 出现天数下拉选择器
- [ ] 点无库存图书的"加入排队" → 仍然正常工作
- [ ] 选 7 天 / 14 天 / 30 天 / 60 天 → 下拉值正确切换
- [ ] 点「确认」→ 弹出 toast「申请已提交」

---

## Bug #2：申请借阅是空白页

**类型**：渲染层 / 组件 return 异常
**预估修复时间**：30 min

### 现象描述

修复 Bug #1 后，点击「申请借阅」按钮成功进入申请流程。但**直接访问** `/request` 页面（或申请提交后被刷新到该页面）时，**只有顶部导航栏可见**，页面主体完全空白——没有标题、没有图书列表、没有借阅历史。Console 无报错，Network 面板也看不到 5xx 状态码。

### 复现步骤

1. 修复 Bug #1 后继续操作
2. 在 `/books` 申请一本书 → toast「申请已提交」
3. 点击顶部导航栏的「申请借阅」按钮（指向 `/request`）
4. **期望**：进入"申请借阅"页面，看到「可选图书」列表 +「我的借阅历史」两个 section
5. **实际**：页面**完全空白**（顶部 nav 正常显示）

> 提示：URL 是 `/request` 没错，页面也没有报错——这说明路由正常匹配，问题在 page 组件的渲染逻辑。

### 期望 vs 实际

- **期望**：`/request` 渲染图书列表卡片网格 + 借阅历史列表
- **实际**：`/request` 主体内容为空白（nav 不受影响，因为它在 `(student)/layout.tsx` 里）

### 关键观察（修复前先想清楚）

调试方向三选一：
- **A. 组件 return null 或空 fragment**：page.tsx 写了 `return null;` 而不是 `return (<div>...)`，最常见的"调试时改坏了"
- **B. 数据查询抛错**：`db.book.findMany` / `db.borrow.findMany` 抛出异常 → 但 Next.js 默认会触发 `error.tsx`，不会空白
- **C. JSX 顶层节点被注释掉**：`<div>...</div>` 整段被 `/* ... */` 包住，但 page 函数体还在

打开 `src/app/(student)/request/page.tsx`，对照源码看：
- 函数末尾的 `return` 语句返回了什么？
- 数据查询是否抛错？（看 `db.book.findMany({ where: { isActive: true } })`）
- 整个 JSX 是否被注释掉？

### 修复方向（给 AI 的提示词）

```
访问 /request 页面是空白页（只有顶部 nav，主体没有内容，无报错）。
请阅读 src/app/(student)/request/page.tsx，分析以下可能：
1. 组件 return 是否返回了 null 或空 fragment
2. 数据查询是否抛错（看 db.book.findMany / db.borrow.findMany）
3. 是否缺少关键 JSX 或 import
请定位根因并修复，让页面正常展示"申请借阅"列表和"我的借阅历史"。
```

**核心改动**：
- `src/app/(student)/request/page.tsx` 让 `return null;` 恢复成正常的 JSX return，恢复页面骨架

**验证清单**（修复后必做）：
- [ ] 访问 `/request` → 顶部 nav +「申请借阅」标题正常显示
- [ ] 「可选图书（共 N 本）」section 显示图书卡片网格
- [ ] 「我的借阅历史」section 显示（即使暂时为空，也显示「暂无申请记录」占位）
- [ ] Console 无 error 级别日志

---

## Bug #3：申请借阅没有借阅记录

**类型**：数据层 / DB 查询条件错误
**预估修复时间**：45 min

### 现象描述

修复 Bug #2 后，`/request` 页面骨架完整显示：在 `/books` 申请了一本书，但回到 `/request` 后「我的借阅历史」section **永远显示「暂无申请记录」**。但去 `/my-borrows` 页面（"当前借阅" tab）**能看到这条借阅**——说明数据库里**确实有这条记录**，只是 `/request` 查不到。

### 复现步骤

1. 修复 Bug #1 + Bug #2 后继续操作
2. 在 `/books` 点「申请借阅」→ 选 30 天 → 点「确认」→ toast「申请已提交」
3. 跳到顶部 nav 的「我的借阅」（`/my-borrows`） → 「当前借阅 (1)」→ **能看到刚借的那本书（PENDING 状态）**
4. 回到顶部 nav 的「申请借阅」（`/request`） → 「我的借阅历史」section
5. **期望**：看到刚才那本书出现在历史中，状态 PENDING
6. **实际**：「暂无申请记录」

> 关键对比点：**同一个数据库的同一行数据**，在 `/my-borrows` 能看到，在 `/request` 看不到。

### 期望 vs 实际

- **期望**：`/request` 显示该用户的全部非 RETURNED 借阅（PENDING/APPROVED/BORROWED/REJECTED）
- **实际**：`/request` 的"我的借阅历史"始终为空

### 关键观察（修复前先想清楚）

这个 bug 是经典的「**数据库没回显 vs 没写回显功能**」二选一：

| 假设 | 验证手段 |
|---|---|
| **A. 数据库没回显**：page.tsx 里的 `db.borrow.findMany` 查询条件有问题，查不到数据 | 看 `where: { userId, status: {...} }` 中的 status 过滤值；用 prisma studio 或 SQL `SELECT * FROM borrows WHERE userId=...` 直接查 |
| **B. 没写回显功能**：查询有数据，但 UI 没渲染（`myRequests.map` 被注释或条件错误） | 看 page.tsx 渲染段是否引用了 `myRequests`，是否有 `.map`、`.length === 0` 判断 |

打开 `src/app/(student)/request/page.tsx`，重点检查：
- 第 14-22 行：`db.borrow.findMany({ where: {...} })` 的 `where` 条件
- 渲染段：`myRequests.length === 0 ? <Empty/> : <List/>` 的渲染逻辑

### 修复方向（给 AI 的提示词）

```
在 /books 申请借阅后，回到 /request 页面的"我的借阅历史"显示"暂无申请记录"，
但 /my-borrows 里能看到该记录。

请阅读 src/app/(student)/request/page.tsx，分析：
1. db.borrow.findMany 的 where 条件是否正确（status 过滤是否包含了 PENDING/APPROVED/BORROWED/REJECTED）
2. 渲染逻辑 myRequests.map 是否完整（注释是否未取消）
3. 数据库实际数据是否符合预期（用 prisma studio 或 SQL 验证）

请定位是"数据库没回显"还是"UI 没写回显"，并修复让 /request 能显示该用户的借阅历史。
```

**核心改动**：
- `src/app/(student)/request/page.tsx:17` 把写错的 `status` 过滤恢复成原本的 `{ in: ["PENDING", "APPROVED", "BORROWED", "REJECTED"] }`

**对比验证**（修复后必做）：
- [ ] `/request` → 「我的借阅历史」出现刚才那本书（状态 PENDING）
- [ ] `/my-borrows` → 「当前借阅 (1)」依然能看到（确认查询范围一致）
- [ ] 用 prisma studio 或 `SELECT * FROM borrows WHERE userId='student1 的 id'` 能查到该记录
- [ ] 切换天数（7/14/30/60）申请 → 列表依然能查到

---

## 提交方式

修复完 3 个 bug 后，建议：

```bash
git add -A
git commit -m "fix: 修复 BUGS.md 中的 3 个 bug（申请借阅流程专项）"
```

如果遇到困难：
1. 用 BUGS.md 里给出的提示词喂给 AI 助手
2. 用 `pnpm typecheck` 验证 TypeScript 编译
3. 用 `pnpm dev` 启动后照"复现步骤"反向验证
4. 用 `prisma studio` 直接看数据库实际数据（验证 Bug #3 时尤其有用）

---

**祝你练习愉快**