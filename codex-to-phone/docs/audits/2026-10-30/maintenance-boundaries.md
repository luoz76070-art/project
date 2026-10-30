# 阶段五：状态模块与统一验证入口

日期：2026-10-30。状态：本轮源码与本地验收完成；未发布、未部署、未做Git写入。保留所有既有修改，未读取真实会话、调用模型或操作审批。

## 结果

新增 `apps/mobile/src/features/chat/runtimeSync.ts`，以 `createRuntimeSync(context)`承接原App中的三类状态更新及两类轮询：Live snapshot、Desktop snapshot、Desktop delta、Live poll和Desktop delta poll。App注入当前runtime getter、Workspace取消signal getter、按线程更新器及鉴权HTTP读取，继续负责四组effect的生命周期。

状态逻辑沿用原守卫及帮助函数，校验仍在React updater内部执行；请求完成时及状态提交时都检查时效。草稿编辑不废弃有效读取，旧turn/旧cursor/取消读取不覆盖新状态，明确reset仍有效。只移除本轮产生的三个未使用App导入，未改变消息身份、发送/排队/审批协议或UI布局。

`test-mobile-reliability.mjs`和`test-mobile-input-transitions.mjs`直接导入生产工厂，减少从App提取五个函数和两处重复函数的测试耦合。四个实际effect仍保留源码提取作为生命周期接线覆盖；诊断导出等其他App处理器的AST测试仍在原处，本轮没有扩大为全App重写。

统一命令、工具链与规则范围见[本地验证入口](../../verification.md)：`verify`有序执行核心检查；`verify:android`执行Android编译/lint；`verify:all`串联全部。固定新增ESLint开发依赖，已有运行时依赖版本保持。正式JDK兼容脚本移到仓库scripts目录，不再依赖ignored output中的临时文件。

## 验证

证据目录：`output/audit/2026-10-30/maintenance-boundaries/`。本轮前文件副本在`before/`，不用于整体回滚其他改动。

| 检查 | 结果 |
| --- | --- |
| 提取前/后可靠性与输入过渡定向回归 | 各30/30；`baseline.log`、`extracted.log` |
| `corepack pnpm verify:all` | 全步骤通过；`verify-all.log` |
| 手机全量 | 121/121 |
| 后端全量 | 377/377 |
| 热更新 / APK更新 / 发布片段隔离回归 | 1/1、5/5、4/4；另含Java检查 |
| 消息回归 / CLI路径发现 / 两端类型 / 两端及插件构建 | 均通过 |
| Android Java编译与lint | BUILD SUCCESSFUL；0 Error、0 Fatal、8 Warning |
| 验证入口自身回归 | 最终6/6；含真实子进程退出7的拒绝断言 |
| 最后清理提取产生的未使用导入后 | lint、typecheck、手机121项、验证入口6项及Web构建再次通过 |
| `git diff --check` | 通过 |

首次完整verify运行时自测5项；随后补充真实子进程非零传播断言，并与最后导入清理一起定向复核至6/6。后端与Android代码未再次改变，无需因此重复构建后端。

实际浏览器使用独立loopback夹具与390×800视口，走真实App接线：临时输入→历史增量→正式身份→终稿→断开恢复→重开，所有阶段用户气泡数均为1，终稿可见且过程折叠；未发送的合成草稿保留，控制台无error。只改变自有合成状态，不调用真实任务；已关闭自有服务/页面并恢复视口。证据为`browser-checks.json`和`browser-reopened.png`。

## 限制与交接

本轮是结构与验证入口整理，合成场景通过不能替代原手机双气泡问题的现场诊断。Android系统保存、安装/更新、实际网络切换仍未验收；本地构建不等于手机已收到更新。

阶段一至五的源码工作已完成。下一轮可选[集成预览与真机验收计划](../../plans/2026-10-30-preview-validation.md)，用户选择前停止。
