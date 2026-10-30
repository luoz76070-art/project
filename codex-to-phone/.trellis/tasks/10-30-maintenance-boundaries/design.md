# 设计与自审

1. 新建features/chat/runtimeSync.ts，将applyLiveTurnSnapshot、applyDesktopStreamSnapshot、applyDesktopDelta、watchDesktopDelta、pollLiveTurn五个函数原样移为createRuntimeSync工厂。只注入当前runtime读取、按thread更新、鉴权HTTP读取和当前Workspace signal。沿用sync.ts守卫、runtime/messages帮助函数，React更新器内部校验保留。App负责生命周期与effect，不引入状态库或新hook框架。
2. reliability与input-transitions回归直接导入工厂；仍提取真实四个effect做生命周期接线检查，另用真实浏览器检查App加载/更新。诊断导出处理器的AST测试留在原处，避免扩大成全量App拆分。
3. 根verify脚本依次运行lint、typecheck、build、build:plugin、隔离测试、消息及更新回归；任何失败非零退出且停止。Android单独verify:android，同时verify:all串联。构建与读dist测试不可并发。允许显式--list显示步骤，不静默跳过缺工具。
4. Android脚本选择可覆盖的JDK17 runner及JDK21+编译器，读取正式scripts/android/lint-jdk.gradle；无硬编码用户路径，环境只传给子进程，无全局配置修改，不禁规则。
5. ESLint使用固定dev依赖，先开启明确正确性规则（如debugger、重复case/赋值条件/Promise executor），新状态模块额外unused检查。不机械格式化或批量修复旧代码，不宣称尚未配置的hooks规则已执行。

改动边界为上述App/module、两套回归、根package/lock与验证配置脚本及文档。保存本轮前副本，先跑现有关键回归作为基线，再跑完整统一入口。
