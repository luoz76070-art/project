# code7 真机与图片网关联动

日期：2026-11-07。用户“进行下一轮”启动[真机计划](../../plans/2026-11-07-remote-rendering-device.md)。目标 A：升级配套电脑网关；B：确认 App 内更新到 code7；C：实际验证执行摘要、字号及本地图片/大图。

## 当前结果

- A 已完成：已交付的0.1.5网关归档复制到长期固定目录，逐文件SHA匹配；旧网关正常管理stop后约2.3秒自然退出，新实例监听并建立原Tunnel。没有强制终止、重复实例、配置迁移或重新配对。
- B 用户已确认“已在 App 内升级到 0.1.5 / code7”。本轮ADB未连接手机，所以安装成功属于用户真机确认，实际已安装APK SHA未独立回拉核对；不冒充自动设备取证。
- C 电脑及公网接口已通过55项检查，当前项目图片完整字节一致；用户已确认手机图片、大图/返回、字号及原连接/草稿/主题通过。折叠范围未通过：执行说明也被隐藏；用户明确要求执行记录常显，仅命令和输出折叠。由 code8 修正，见[执行说明修正](execution-notes.md)；新折叠效果仍需手机复测，整体继续进行中。

## 网关与保存项

旧入口 `releases/2026-11-04-cold-thread-5f541953c762/mobile-codex/lib/gateway.mjs`，原PID60246。新入口 `~/Library/Application Support/Mobile Codex Gateway/releases/2026-11-07-kelivo-images-a96929560c60/mobile-codex/lib/gateway.mjs`，PID45270，实例 `c0ff4578-3e91-4cc0-ac25-7f4917d31a24`。实际bundle SHA256 `a96929560c60980b51a2fe8253b3c4b3209b0594a6311414416de04f9eec4944`，与GitHub版本目录的网关元数据相同。

私有备份位于 `~/Library/Application Support/Mobile Codex Gateway/backups/2026-11-07-kelivo-images-1794007900977/`：旧完整网关、原配置及实际存在的设备/语音凭证。桌面待发文件原本不存在，保持不存在；未创建空文件。配置、设备、语音凭证逐文件hash及原Codex/DeepSeek宿主PID保持，原workspace/端口/配对身份不变，未安装LaunchAgent。原包与备份保留，回退须先正常stop当前实例、确认PID退出和端口释放，再从原入口按同配置start；本轮没有执行故障回退演练。

## 检查与边界

- 隔离图片/网关测试19项通过；独立候选语法与service status通过，未重新构建已交付产物。原构建和340项原生/完整lint证据沿用[code7修复审计](remote-rendering.md)。
- 切换前只读检查确认Codex两条已有订阅无待发、审批、提问或未知提交；当前任务继续运行，未向模型另发任务或进行审批。旧实例管理stop202、端口释放、PID自然退出、新程序/PID、原Tunnel与本地/公网同实例分别核验。
- 本地和公网均从当前会话项目读取同一24,806字节JPEG，绝对/相对/file/编码路径全部一致，Cache-Control:no-store及Android CORS正确；无鉴权401、项目外403、缺失404、非图片415、坏路径400，预检204。手机图像显示、大图打开和返回随后已由用户明确确认；该确认不扩大到所有图片类型或其他Agent。
- 发现旧环境DeepSeek桥接端口9876没有监听、会话接口502；新网关后同样502。该问题先于本轮升级，保留原宿主与配置，本轮搁置，未记为新回归或已修复。

原始证据与操作脚本位于 `output/audit/2026-11-07/device-link/`，公开回执见[device-link-verification.json](device-link-verification.json)。本轮复用原固定网关备份/切换/只读检查流程，没有新增通用技能或自动化；59组完整功能、原Desktop新建、其他Agent本地图片均不扩大验收。
