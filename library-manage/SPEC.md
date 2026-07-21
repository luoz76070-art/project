# SPEC — 图书借阅管理系统

> 版本: 1.0 · 状态: 已冻结（待实施）
> 最后更新: 2026-07-21
> 适用范围: `/home/circleci/project/library-manage/`

---

## 1. 背景与目标

打造一个**用于展示与用户研修**的图书借阅管理系统。MVP 阶段聚焦核心三页面与角色权限闭环，UI 走柔和奶油白 + 鼠尾草绿路线，整体观感清晰易懂、柔和简约。后续迭代逐步引入 AI Agent 等智能化能力。

---

## 2. 用户角色

| 角色 | 关键能力 | 默认账号（演示用） |
|---|---|---|
| **Student（学生）** | 图书查询、申请借阅、查看我的借阅、归还、查看排队进度 | `student1` / `pass1234` |
| **Admin（管理员）** | Student 全部 + 图书 CRUD、用户管理、借阅审批、补货、AI 助理（接口预留） | `admin` / `admin1234` |

> 角色扩展性：所有权限判断走集中式 `hasPermission(role, action)` 函数，新角色只需扩展枚举与权限表，**无需改动业务代码**。

---

## 3. 功能范围（MVP）

### 3.1 学生侧（三页面）

#### 页面 1：图书列表查询 `/books`
- 网格/列表切换，卡片含封面、书名、作者、ISBN、可借数量（`availableCopies / totalCopies`）
- 搜索（书名/作者）、分类筛选、状态筛选（在馆/全部/无库存）
- 每张卡片含"申请借阅"按钮
- 当 `availableCopies > 0` → 按钮为"立即借阅"
- 当 `availableCopies = 0` → 按钮为"加入排队"，并显示当前排队人数

#### 页面 2：申请借阅 `/request`
- 表单选择图书 + 期望借阅时长（默认 30 天，下拉 7/14/30/60）
- 提交后：
  - 若 `availableCopies > 0` → 直接进入 `Borrow` 表（`status=APPROVED`），等待管理员审批
  - 若 `availableCopies = 0` → 进入 `Reservation` 排队表，记录 `queuePosition`
- 我的申请历史（待审批 / 已批准 / 已借出 / 已归还 / 已拒绝）

#### 页面 3：我的借阅与归还 `/my-borrows`
- Tab 1：**当前借阅** — 列表展示，可执行"归还"操作
- Tab 2：**历史记录** — 已归还的借阅
- Tab 3：**排队中** — 当前所在队列及预计等待时间估算

### 3.2 管理员侧 `/admin/*`

| 路由 | 功能 |
|---|---|
| `/admin/books` | 图书 CRUD、补货（增加 `totalCopies`）、上下架 |
| `/admin/borrows` | 待审批借阅列表（按 `requestedAt` 升序），批准/拒绝 |
| `/admin/users` | 用户列表、新增用户、调整角色、停用 |
| `/admin/ai-assistant` | AI Agent 对话面板（**MVP 阶段为接口预留**，显示 mock 回复） |

### 3.3 认证 `/login`
- 用户名 + 密码登录
- 失败提示（不暴露具体错误）
- 登录后按角色重定向：Student → `/books`，Admin → `/admin/books`

---

## 4. 核心业务规则

### 4.1 库存与排队（关键）
```
用户A申请借阅《X》（库存 1）  → Borrow.status=APPROVED, availableCopies: 1→0
用户B申请借阅《X》（库存 0）  → Reservation.queuePosition=1, requestedAt=B
用户C申请借阅《X》（库存 0）  → Reservation.queuePosition=2, requestedAt=C
用户A归还《X》                → availableCopies: 0→1
                                 自动晋升 Reservation[0]（即B）→ Borrow.status=APPROVED
                                 queuePosition 重排（C: 1→1，不需要重新分配）
```
- 所有库存与状态变更通过 **Prisma `$transaction`** 保证原子性
- 排队顺序由 `Reservation.createdAt` 决定（`queuePosition` 为冗余字段，便于查询）

### 4.2 借阅生命周期
```
状态机：
PENDING（学生提交后初始）→ APPROVED（管理员批准）→ BORROWED（管理员标记已发书）→ RETURNED（学生或管理员归还）
                                                  ↘ OVERDUE（超期未还，系统每日扫描）
                                                  ↘ REJECTED（管理员拒绝）
```

### 4.3 权限矩阵
| 动作 | Student | Admin |
|---|---|---|
| 查看图书列表 | ✅ | ✅ |
| 申请借阅 | ✅ | ✅ |
| 归还自己借的书 | ✅ | ✅ |
| 审批借阅 | ❌ | ✅ |
| 补货/下架 | ❌ | ✅ |
| 用户管理 | ❌ | ✅ |
| 查看所有借阅 | ❌ | ✅ |
| AI 助理 | ❌ | ✅ |

---

## 5. 技术栈

| 层 | 选型 | 版本要求 |
|---|---|---|
| 框架 | Next.js (App Router) | 16+ |
| UI 库 | React | 19+ |
| 语言 | TypeScript | 5+ |
| 样式 | TailwindCSS | 4+ |
| 组件 | shadcn/ui（Radix UI 底层） | latest |
| 数据库 | SQLite（本地文件） | — |
| ORM | Prisma | 5+ |
| 认证 | NextAuth.js (Auth.js v5) | 5+ |
| 密码哈希 | bcryptjs | latest |
| 表单校验 | Zod | 3+ |
| AI SDK | Vercel AI SDK（OpenAI 兼容） | latest |
| LLM 提供方 | MiniMax（OpenAI 兼容接口） | — |
| License | MIT | — |

---

## 6. 数据模型（Prisma schema）

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:../data/library.db"
}

enum Role {
  STUDENT
  ADMIN
}

enum BorrowStatus {
  PENDING
  APPROVED
  BORROWED
  RETURNED
  OVERDUE
  REJECTED
}

model User {
  id            String   @id @default(cuid())
  username      String   @unique
  passwordHash  String
  displayName   String
  role          Role     @default(STUDENT)
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  borrows       Borrow[]
  reservations  Reservation[]

  @@map("users")
}

model Book {
  id               String   @id @default(cuid())
  title            String
  author           String
  isbn             String?  @unique
  category         String?
  description      String?
  coverUrl         String?
  totalCopies      Int      @default(1)
  availableCopies  Int      @default(1)
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  borrows          Borrow[]
  reservations     Reservation[]

  @@map("books")
}

model Borrow {
  id             String       @id @default(cuid())
  userId         String
  bookId         String
  status         BorrowStatus @default(PENDING)
  requestedDays  Int          @default(30)
  requestedAt    DateTime     @default(now())
  approvedAt     DateTime?
  borrowedAt     DateTime?
  dueAt          DateTime?
  returnedAt     DateTime?
  rejectReason   String?

  user  User  @relation(fields: [userId], references: [id])
  book  Book  @relation(fields: [bookId], references: [id])

  @@index([userId, status])
  @@index([bookId, status])
  @@map("borrows")
}

model Reservation {
  id            String   @id @default(cuid())
  userId        String
  bookId        String
  queuePosition Int
  createdAt     DateTime @default(now())
  fulfilledAt   DateTime?

  user User @relation(fields: [userId], references: [id])
  book Book @relation(fields: [bookId], references: [id])

  @@unique([bookId, queuePosition])
  @@index([bookId, createdAt])
  @@map("reservations")
}
```

---

## 7. 主题与设计规范

### 7.1 色板（CSS 变量，定义于 `globals.css`）
```css
:root {
  --background:      #FAFAF7;   /* 奶油白 */
  --foreground:      #2C3E2E;   /* 深鼠尾草绿（文字） */
  --card:            #FFFFFF;
  --card-foreground: #2C3E2E;
  --primary:         #02FF73;   /* 鼠尾草绿主色 */
  --primary-foreground: #1A2E1F;
  --secondary:       #09ADAA;   /* 辅助青绿 */
  --muted:           #F0EDE5;   /* 浅米灰 */
  --muted-foreground:#6B7268;
  --accent:          #E8F5E9;   /* 浅绿背景 */
  --destructive:     #D97757;   /* 暖红（非刺眼） */
  --border:          #E8E4D9;   /* 暖灰边框 */
  --input:           #E8E4D9;
  --ring:            #02FF73;
  --radius:          0.75rem;   /* 圆角 12px */
}
```

### 7.2 字体
- 中文：系统字体栈 `-apple-system, "PingFang SC", "Microsoft YaHei"`
- 英文：`Inter`（通过 `next/font` 引入）

### 7.3 间距与节奏
- 卡片：`p-6`，圆角 `rounded-xl`，边框 1px `--border`
- 按钮：高度 40px（md）/ 36px（sm），主色按钮 `--primary`
- 页面容器：`max-w-7xl mx-auto px-6 py-8`
- 头部栏：`sticky top-0 z-10 bg-background/80 backdrop-blur`

---

## 8. 目录结构

```
library-manage/
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── data/
│   └── library.db              # 运行 seed 后生成
├── public/
│   └── covers/                 # 图书封面占位图（可空）
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx            # 重定向到 /books 或 /login
│   │   ├── (auth)/
│   │   │   └── login/page.tsx
│   │   ├── (student)/
│   │   │   ├── layout.tsx      # Student 导航 + 角色守卫
│   │   │   ├── books/page.tsx          # ⭐ 页面1：图书列表查询
│   │   │   ├── request/page.tsx        # ⭐ 页面2：申请借阅
│   │   │   └── my-borrows/page.tsx     # ⭐ 页面3：我的借阅/归还
│   │   ├── (admin)/
│   │   │   ├── layout.tsx      # Admin 导航 + 角色守卫
│   │   │   └── admin/
│   │   │       ├── books/page.tsx
│   │   │       ├── borrows/page.tsx
│   │   │       ├── users/page.tsx
│   │   │       └── ai-assistant/page.tsx
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       └── ai/chat/route.ts        # 接口预留
│   ├── components/
│   │   ├── ui/                 # shadcn 生成
│   │   ├── book-card.tsx
│   │   ├── borrow-status-badge.tsx
│   │   ├── nav-bar.tsx
│   │   └── theme-provider.tsx
│   ├── lib/
│   │   ├── db.ts               # PrismaClient 单例
│   │   ├── auth.ts             # NextAuth 配置
│   │   ├── permissions.ts      # hasPermission(role, action)
│   │   ├── actions/            # Server Actions
│   │   │   ├── books.ts
│   │   │   ├── borrows.ts
│   │   │   ├── reservations.ts
│   │   │   └── users.ts
│   │   └── ai/
│   │       ├── tools.ts        # 工具定义（供后续接入）
│   │       └── mock.ts         # MVP 阶段 mock 回复
│   ├── middleware.ts           # 路由角色守卫
│   └── types/
│       └── next-auth.d.ts      # Session 类型扩展 role
├── .env.example
├── .gitignore
├── components.json             # shadcn 配置
├── next.config.ts
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── LICENSE                     # MIT
└── README.md
```

---

## 9. 关键文件约定

### 9.1 `package.json` scripts
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:seed": "tsx prisma/seed.ts",
    "db:reset": "prisma db push --force-reset && pnpm db:seed"
  }
}
```

### 9.2 `.env.example`
```env
DATABASE_URL="file:./data/library.db"
NEXTAUTH_SECRET="please-generate-with-openssl-rand-base64-32"
NEXTAUTH_URL="http://localhost:3000"
# MVP 阶段未启用，留空即可
AI_PROVIDER_API_KEY=""
AI_PROVIDER_BASE_URL="https://api.MiniMax.com/v1"
AI_MODEL="MiniMax-M2"
```

### 9.3 演示账号（seed.ts 写入）
- `admin / admin1234`（displayName: 管理员）
- `student1 / pass1234`（displayName: 张同学）
- `student2 / pass1234`
- `student3 / pass1234`
- `student4 / pass1234`
- `student5 / pass1234`

种子图书：10 本，混合不同 `totalCopies`（1、2、3 本不等），其中至少 2 本 `availableCopies = 0` 以演示排队。

---

## 10. Server Actions 清单

| 文件 | 函数 | 说明 |
|---|---|---|
| `books.ts` | `searchBooks(query, category)` | 学生侧列表查询 |
| `books.ts` | `createBook(input)` / `updateBook(id, input)` / `deleteBook(id)` / `restockBook(id, delta)` | 管理员 CRUD |
| `borrows.ts` | `requestBorrow(bookId, requestedDays)` | 学生申请（含排队逻辑） |
| `borrows.ts` | `returnBorrow(borrowId)` | 学生/管理员归还（含晋升队列） |
| `borrows.ts` | `approveBorrow(borrowId)` / `rejectBorrow(borrowId, reason)` | 管理员审批 |
| `borrows.ts` | `markAsBorrowed(borrowId)` | 管理员确认发书 |
| `reservations.ts` | `getMyQueues(userId)` | 学生查看排队 |
| `reservations.ts` | `promoteNextReservation(bookId)` | 内部工具：归还时触发 |
| `users.ts` | `createUser(input)` / `updateUserRole(id, role)` / `deactivateUser(id)` | 管理员用户管理 |

所有 Server Action 必须：
1. 在函数顶部调用 `requireSession()` 校验登录
2. 调用 `hasPermission()` 校验权限
3. 数据库写入使用 `prisma.$transaction([...])`

---

## 11. AI Agent 接口预留（MVP）

### 11.1 路由
`POST /api/ai/chat`
- 请求体：`{ messages: { role, content }[] }`
- 响应：流式（SSE）或普通 JSON（MVP 用普通 JSON 即可）
- MVP 行为：识别关键词（"逾期"/"补货"/"审批"等）返回 mock 文案 + 提示"AI 能力即将上线"

### 11.2 工具定义文件 `src/lib/ai/tools.ts`
即使 MVP 不接入，也必须**预先定义**以下工具（方便后续接入）：
```ts
export const tools = [
  { name: 'get_overdue_books', description: '查询所有逾期借阅', parameters: {} },
  { name: 'get_pending_borrows', description: '查询待审批借阅数量', parameters: {} },
  { name: 'approve_borrow', description: '批准指定借阅', parameters: { borrowId: 'string' } },
  { name: 'reject_borrow', description: '拒绝指定借阅', parameters: { borrowId: 'string', reason: 'string' } },
  { name: 'restock_book', description: '为指定图书补货', parameters: { bookId: 'string', delta: 'number' } },
  { name: 'get_book_stats', description: '查询图书借阅统计', parameters: { bookId: 'string' } },
  { name: 'get_user_history', description: '查询用户借阅历史', parameters: { userId: 'string' } },
];
```

---

## 12. 交付物清单（MVP 必交付）

- [x] 项目脚手架可 `pnpm dev` 启动
- [x] `pnpm db:push && pnpm db:seed` 可一键建表 + 种子
- [x] 三页面可正常操作（查询→申请→归还 全链路）
- [x] 多用户排队逻辑可演示（造数据使一本书 `availableCopies=0`）
- [x] 角色守卫：Student 访问 `/admin/*` 被重定向
- [x] 主题：奶油白 + 鼠尾草绿，圆角柔和
- [x] AI 助理页可访问，显示 mock 回复 + "功能即将上线"占位
- [x] README 含演示账号、启动步骤、技术栈说明
- [x] LICENSE（MIT）

---

## 13. 显式不在 MVP 范围

- ❌ AI Agent 真实调用 MiniMax-M2（仅接口预留）
- ❌ 邮件 / 站内信通知
- ❌ 逾期定时扫描脚本（手动标记演示即可）
- ❌ 单元测试 / E2E 测试
- ❌ Docker 化部署
- ❌ i18n 国际化
- ❌ 深色模式（后续扩展）
- ❌ 借阅统计图表
- ❌ 批量导入图书（CSV/Excel）

---

## 14. 验收标准（MVP 完成定义）

1. 克隆/初始化后，按 README 步骤可在本地 5 分钟内启动并看到登录页
2. 用 `student1` 登录后能完成：浏览图书 → 申请借阅（库存充足）→ 归还 全流程
3. 用 `student2` 对同一本库存为 0 的图书申请借阅，能看到排队信息
4. 用 `admin` 登录后能完成：审批借阅、补货图书、新增用户
5. Student 账号直接访问 `/admin/*` 被重定向回 `/books`
6. 整站配色与圆角统一，无 Tailwind 默认蓝紫色调泄露
7. 控制台无报错（warning 可接受）

---

## 15. 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-07-21 | 1.0 | 初始冻结版本，作为 MVP 实施依据 |