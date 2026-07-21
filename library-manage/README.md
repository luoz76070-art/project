# 📚 图书借阅管理系统（Library Manage）

> 柔和奶油白 + 鼠尾草绿的图书借阅管理系统，用于展示与用户研修。
> MVP 聚焦三页面 + 角色权限闭环 + 排队逻辑，AI Agent 预留接口位。

![Status](https://img.shields.io/badge/status-MVP-success)
![License](https://img.shields.io/badge/license-MIT-blue)
![Next.js](https://img.shields.io/badge/Next.js-15-black)

---

## ✨ 特性

- 🎨 **柔和简约 UI**：奶油白背景 + 鼠尾草绿主色，圆角柔和
- 👥 **角色权限**：学生 / 管理员两套权限矩阵，扩展性友好
- 📚 **库存与排队**：图书有总数 / 可借数双重属性，无库存自动按时间排队
- 🔁 **归还晋升**：归还时自动晋升队列首位，无需手动干预
- 🤖 **AI 助理（预留）**：管理员侧 AI 对话面板，工具定义已就绪，待接入 MiniMax-M2
- 💾 **零依赖部署**：SQLite 单文件数据库，无需额外服务

---

## 🚀 本地部署指南

### 📋 环境要求

| 工具 | 版本 | 安装 |
|---|---|---|
| Node.js | >= 20 | https://nodejs.org |
| npm | 自带 | — |
| pnpm（可选，更快） | >= 8 | `npm install -g pnpm` |

### 🎯 方案 A：Git 克隆（最推荐）

仓库地址：https://github.com/luoz76070-art/project

#### Windows / macOS / Linux 通用步骤

```bash
# 1. 进入你想放项目的目录
cd ~/projects                # 或任意目录

# 2. 克隆（会创建 library-manage 目录）
git clone https://github.com/luoz76070-art/project.git library-manage

# 3. 进入项目目录
cd library-manage

# 4. 安装依赖（首次 1-3 分钟）
npm install                  # 或 pnpm install（更快）

# 5. 初始化环境变量（默认值已可用）
cp .env.example .env
# Windows PowerShell: copy .env.example .env

# 6. 初始化 SQLite 数据库 + 写入演示数据
npm run db:push              # 建表
npm run db:seed              # 写入 1 admin + 5 students + 10 books

# 7. 启动开发服务器
npm run dev                  # 或 pnpm dev
```

打开浏览器访问 **http://localhost:3000**

#### 🚀 一键复制脚本（Linux/macOS）

```bash
git clone https://github.com/luoz76070-art/project.git library-manage && \
cd library-manage && \
cp .env.example .env && \
npm install && \
npm run db:push && \
npm run db:seed && \
echo "✅ 安装完成！运行 npm run dev 启动"
```

### 🎯 方案 B：下载 ZIP（不想用 git）

浏览器打开：

👉 https://github.com/luoz76070-art/project/archive/refs/heads/main.zip

下载后解压，进入 `project-main` 目录，从上面的 **步骤 4** 继续。

### 🎯 方案 C：生产模式部署

```bash
# 获取代码后（任选 A 或 B 方式）
npm install
cp .env.example .env
npm run db:push
npm run db:seed

# 编译生产版本
npm run build

# 启动生产服务（默认 3000 端口）
npm start
```

---

## 🔐 演示账号

| 角色 | 用户名 | 密码 | 说明 |
|---|---|---|---|
| 管理员 | `admin` | `admin1234` | 全功能权限 |
| 学生 | `student1` | `pass1234` | 张同学 |
| 学生 | `student2` | `pass1234` | 李同学（在排队） |
| 学生 | `student3` | `pass1234` | 王同学（在排队） |
| 学生 | `student4` | `pass1234` | 陈同学 |
| 学生 | `student5` | `pass1234` | 刘同学 |

---

## ❓ 常见问题

**Q1: 端口 3000 被占用怎么办？**

```bash
# Linux / macOS
PORT=3001 npm run dev

# Windows PowerShell
$env:PORT=3001; npm run dev
```

**Q2: 重新初始化数据库？**

```bash
npm run db:reset              # 清空并重新写入种子
```

**Q3: 切换到 PostgreSQL / MySQL？**

修改 `prisma/schema.prisma` 中的 `datasource db` 段：

```prisma
datasource db {
  provider = "postgresql"     # 或 "mysql"
  url      = env("DATABASE_URL")
}
```

再调整 `.env` 中的 `DATABASE_URL`，重新运行 `npm run db:push` 即可。

**Q4: 默认端口改了，部署到服务器用什么？**

开发用 `npm run dev`，生产用 `npm start`（默认 3000）。部署到云服务器时建议用 PM2 / Docker / systemd 守护进程，监听 0.0.0.0：

```bash
pm2 start npm --name library-manage -- start
# 或指定端口
PORT=8080 HOSTNAME=0.0.0.0 pm2 start npm --name library-manage -- start
```

**Q5: AI Agent 如何启用？**

当前 MVP 阶段为 mock 回复（见 `src/app/api/ai/chat/route.ts`）。要接入真实模型：

1. 在 `.env` 配置：
   ```env
   AI_PROVIDER_API_KEY="your-key"
   AI_PROVIDER_BASE_URL="https://api.MiniMax.com/v1"
   AI_MODEL="MiniMax-M2"
   ```
2. 安装 Vercel AI SDK：`npm install ai @ai-sdk/openai`
3. 将 `src/app/api/ai/chat/route.ts` 中的 mock 回复替换为 `streamText({ model, tools, messages })`

**Q6: cloudflared trycloudflare 临时 URL 还能用吗？**

不能，那是 CircleCI 沙箱里临时公开的，仅用于当时演示。沙箱关闭后失效。本地部署请用 `http://localhost:3000`。

---

## 🧭 页面导览

### 学生侧

| 路径 | 说明 |
|---|---|
| `/login` | 登录页 |
| `/books` | ⭐ 页面 1：图书列表查询（搜索 / 筛选 / 申请） |
| `/request` | ⭐ 页面 2：申请借阅（表单 + 历史 + 排队） |
| `/my-borrows` | ⭐ 页面 3：我的借阅与归还（三个 Tab） |

### 管理员侧

| 路径 | 说明 |
|---|---|
| `/admin/books` | 图书 CRUD + 补货 + 上下架 |
| `/admin/borrows` | 借阅审批 + 状态过滤 |
| `/admin/users` | 用户列表 + 新增 + 角色 / 状态调整 |
| `/admin/ai-assistant` | AI Agent 对话面板（mock 回复） |

---

## 🛠️ 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 15 (App Router) |
| UI | React 19 + shadcn/ui (Radix UI) |
| 样式 | TailwindCSS 3 |
| 数据库 | SQLite (Prisma ORM) |
| 认证 | NextAuth.js v5 (Credentials + JWT) |
| 校验 | Zod |
| 图标 | lucide-react |
| LLM（待接入） | MiniMax-M2 (OpenAI 兼容) |

---

## 📂 目录结构

```
library-manage/
├── prisma/
│   ├── schema.prisma        # 数据库模型
│   └── seed.ts              # 种子数据
├── data/                    # SQLite 数据库目录（运行 seed 后生成）
├── src/
│   ├── app/                 # Next.js App Router 页面
│   │   ├── (auth)/login/    # 登录
│   │   ├── (student)/       # 学生页面组
│   │   ├── (admin)/admin/   # 管理员页面组
│   │   └── api/             # API 路由
│   ├── components/          # 共享组件
│   │   └── ui/              # 基础 UI 组件
│   ├── lib/
│   │   ├── actions/         # Server Actions
│   │   ├── ai/              # AI Agent 工具定义 + mock
│   │   ├── auth.ts          # NextAuth 配置
│   │   ├── db.ts            # Prisma 客户端
│   │   ├── enums.ts         # 角色 / 状态枚举
│   │   └── permissions.ts   # 权限矩阵
│   ├── middleware.ts        # 路由守卫
│   └── types/               # 类型扩展
├── SPEC.md                  # 项目规格文档（实施依据）
└── README.md
```

---

## 📦 常用脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动开发服务 |
| `npm run build` | 生产构建 |
| `npm start` | 启动生产服务 |
| `npm run lint` | ESLint 检查 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run db:push` | 同步 schema 到数据库 |
| `npm run db:seed` | 写入种子数据 |
| `npm run db:reset` | 重置数据库 + 种子 |

> 将上述 `npm` 替换为 `pnpm` 也可（推荐 pnpm，更快）。

---

## 🤖 AI Agent 接入（后续迭代）

已注册工具（`src/lib/ai/tools.ts`）：

- `get_overdue_books` — 查询逾期借阅
- `get_pending_borrows` — 查询待审批数量
- `approve_borrow` — 批准借阅
- `reject_borrow` — 拒绝借阅
- `restock_book` — 补货
- `get_book_stats` — 图书统计
- `get_user_history` — 用户历史

接入 MiniMax-M2 时，在 `.env` 配置：

```env
AI_PROVIDER_API_KEY="your-key"
AI_PROVIDER_BASE_URL="https://api.MiniMax.com/v1"
AI_MODEL="MiniMax-M2"
```

然后将 `src/app/api/ai/chat/route.ts` 中的 mock 回复替换为 Vercel AI SDK 调用。

---

## 📄 License

MIT © 2026