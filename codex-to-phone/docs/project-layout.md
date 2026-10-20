# 工程布局与 Trellis 工作入口

更新：2026-10-20。本次完成模块布局重构，并开始审核计划的第一批连接修复。

## 顶层职责

```text
codex-to-phone/
├── AGENTS.md                    # 本项目约定与 Trellis 入口
├── .trellis/
│   ├── config.yaml              # mobile/relay 包映射；inline；禁止自动提交
│   ├── spec/                    # 基于源码的前后端规范与传输契约
│   ├── tasks/                   # 优化总任务、子任务和已完成归档
│   └── workspace/rorance/        # 验证与续接记录
├── .agents/skills/              # Trellis 项目技能
├── .codex/                      # Trellis 的本项目 Codex 配置
├── apps/
│   ├── mobile/                  # React + Capacitor；android/ 保持原位置
│   │   └── src/
│   │       ├── main.tsx         # 仅 React 挂载和全局样式
│   │       ├── app/             # App 编排、类型、参数
│   │       ├── features/
│   │       │   ├── chat/        # 消息、附件、展示组件、运行态缓存、滚动
│   │       │   ├── connection/  # HTTP、查询、档案和诊断
│   │       │   ├── threads/     # 线程/项目分组模型
│   │       │   └── updates/     # 原生更新插件适配
│   │       ├── shared/          # 格式、偏好、剪贴板
│   │       └── styles.css       # 现有样式；UI 对齐另按计划实施
│   └── relay/
│       ├── src/
│       │   ├── server.ts / serverExe.ts  # Node / Windows SEA 入口
│       │   ├── brokerServer.ts          # Broker 兼容入口
│       │   ├── remoteTunnelClient.ts    # Tunnel 兼容入口
│       │   ├── config.ts                # Relay 配置
│       │   ├── server/                  # 唯一路由工厂与 SSE 生命周期
│       │   ├── transport/               # Broker、Tunnel、协议和心跳
│       │   ├── codex/                   # 可执行文件、app-server 与 turn
│       │   ├── desktop/                 # Desktop IPC 与 macOS 输入
│       │   ├── store/                   # JSONL 和上传存储
│       │   ├── smoke/                   # 人工集成 smoke / 探测
│       │   └── codexStore.ts            # 已有审核复现工具的兼容导出
│       ├── scripts/clean-dist.mjs       # 构建前清理本包生成目录
│       └── tests/transport.test.mjs     # 不调用模型的隔离回归
├── scripts/                     # 跨应用构建、发布、原生 helper 和历史管理器
├── docs/                        # 产品、架构、运维与审核证据
├── generated-protocol/          # 生成协议；保持与人工维护代码分离
└── output/、dist-*/、*.app        # 本地验证/打包产物，继续忽略
```

保留原启动脚本和 `dist/server.js`、`dist/brokerServer.js`、`dist/remoteTunnelClient.js` 等入口，避免影响现有 Mac App 和部署命令。Windows SEA 复用 Node 服务路由；原先两套路由的差异以 Node `server.ts` 为基准收敛，仍需 Windows 实机验证。macOS 输入 helper 的资源定位已随目录深度调整。

前端本次迁移了 121 个顶层函数，函数体逐一与迁移前快照比对一致；消息合并模块按原内容迁移。`App.tsx` 仍承担主要交互编排，订阅与连接状态继续按后续正确性任务拆分，不能把拆文件视为所有架构问题已经解决。

## 工作入口

每次先读 `docs/project-index.md`、对应 `.trellis/spec/` 和当前任务的 PRD/design/implement。用户已授权执行的范围先落盘、自审，再执行；不因模板流程重复请求批准。新产品决定有歧义时才澄清。

```bash
python3 .trellis/scripts/get_context.py --mode packages
python3 .trellis/scripts/task.py list
corepack pnpm typecheck
corepack pnpm test:messages
corepack pnpm test:transport
corepack pnpm test:codex-executable
corepack pnpm build
```

Trellis 的任务与会话自动提交已禁用；不建分支、不暂存、不提交、不推送。`task.py archive --skip-branch-validation` 在本地完成验收后只归档任务材料，不代表已发布或合并。全局 Codex hooks 的开关未改动，当前会话直接读取规范并运行脚本。

## 当前优化顺序

1. 布局：Trellis、模块边界、服务入口去重、构建与消息回归。
2. A1 传输：F01/F02/F03 与 F19 的传输层部分；公网流、CORS、心跳、取消、连接隔离和缓冲边界。
3. A2 正确性：手机订阅恢复/档案隔离、JSONL 边界、客户端初始化、热更新路径、运行依赖与发送语义。
4. B/C：持续开销、索引/缓存/分页、后台监督/唤醒、配对、发布和诊断。
5. D UI：以真实 Codex 手机版画面建立对照，实施衔接连接/缓存边界，保持轻量化。

完整优先级和验收门槛见 [审核计划](audits/2026-10-20/README.md)。真实发送、Android 真机、Windows 全流程及线上/长期运行仍需分别验收。
