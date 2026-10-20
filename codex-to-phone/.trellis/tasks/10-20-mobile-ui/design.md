# D 设计与真实参考

采集日期 2026-10-20，官方 Codex on mobile 文档 https://learn.chatgpt.com/docs/mobile；真实画面保存在 output/ui-reference/2026-10-20/official-mobile-tasks.jpg 与 official-mobile-approve.jpg。

- 顶栏：返回/线程入口、标题与电脑/项目、设置，使用单色窄边框和轻状态点。
- 线程页：主机筛选、项目分组、轻选中态、搜索/分页，窄屏抽屉。保留现有桌面分屏选项，手机默认单列。
- 聊天：用户靠右浅灰气泡、助手无卡片正文，Markdown 基础排版与独立横向代码块，复制动作位于回复下。工具折叠。
- 输入：两行大圆角容器，文本在上，附件/真实控制模式/发送或停止在下。无模型/Cloud/桌面审批的虚假入口。
- 设置：优先配对与连接档案，更新与诊断按需查看；重连状态轻提示、正文保留。
- 浅深主题、44px 触控区域、安全区、大字号、减少动态效果；沿用 React/CSS/Lucide，不增加 UI/Markdown 大依赖。

浏览器使用合成会话检查 360/390/430px；Android 键盘与前后台留到真机验收。

## 真实工作状态修复（按用户最新要求收窄）

用户已确认会话记录同步，本轮保持历史与列表逻辑。桌面 IPC socket 当前不存在，因此状态和正文使用现有 JSONL→SSE 链路。

- Store 初始读取向前查找最近生命周期标记，最多扫描 8 MiB，只补状态、不改变消息页、字节 cursor/generation 或历史分页。
- 统一从 task_started/task_complete/turn_aborted 等显式事件推导 turnStatus；初始聊天读取也返回状态。普通文本不代表完成；现代 custom_tool_call、item_completed 仅产生粗粒度工作阶段，不暴露参数或隐藏推理。
- 现有 SSE 携带可选 activity 枚举，保持原连接、配额和取消清理，无新增轮询或目录订阅。
- 前端应用初始状态及后续 delta，显示思考/执行/输出；无消息时也有工作提示。明确终态即停止提示，不以是否收到助手正文决定完成。
- 变更限于 Store 状态解析、聊天运行态与显示、合成测试和构建版本。

## 手机更新恢复

- 使用 apps/mobile/.env.production.local 持久保存既有 VITE 更新源；Vite 生产构建自动加载，通用配置仍支持环境覆盖。
- apps/mobile/scripts/check-update-sources.mjs 检查双通道 URL；Mac APK 入口在构建前调用。具名交付包必须有两个有效 HTTPS 地址，mac-local 支持显式离线模式。
- 生成 APK 18 和仅原生 18 兼容的 HTML，走现有原子发布脚本恢复原静态更新源；检查线上清单、下载完整性、CORS 与签名，保留 previous.json。
- 不改变 Relay、会话或手机凭证，不替手机确认 Android 安装。
