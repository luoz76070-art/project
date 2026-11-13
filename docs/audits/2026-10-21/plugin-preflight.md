# 插件安装前复核（2026-10-21）

## 结果

完成插件元数据与版本门修正，并更新本地候选包。后端隔离回归210/210（Claude31、Codex问答27）、两端类型检查、Relay及独立插件构建通过；Codex技能quick_validate通过。实际安装与原会话写入仍未验收，不能将候选包称为可直接迁移生产的发行版。

## Codex

当前Desktop捆绑CLI为0.163.0-alpha.10.2。只运行help核对，支持plugin及marketplace管理，但没有plugin validate；没有执行marketplace add或安装。管理技能依赖运行网关的电脑，按官方desktop-only文档补齐`extensions.com.openai.requires_local_executor=true`。

官方页面存档：`output/research/2026-10-21/openai-plugin-desktop-only.html`。技能校验使用临时uv工具环境提供PyYAML，未向项目新增运行依赖或修改Agent配置；输出保存为`output/audit/2026-10-21/plugin-skill-validation.txt`。

## Claude

固定API声明生成于2.1.277，官方Mods入门文档要求宿主2.1.287或以后。模块与Relay登记门已统一为2.1.x且patch>=287，拒绝277、286、旧版本及未知主次版本；合成用例以287验证，不代表这些宿主已实测。API固定声明及模块入口保持，未猜测新接口或加载方式。

当日官方入门存档为`output/research/2026-10-21/claude-mods-create.md`；本轮重取返回HTTP403，采用已保存的主源。该要求与类型声明生成版本分开记录。

本机CLI仍为2.1.220。在临时CLAUDE_CONFIG_DIR、禁用非必要流量的环境运行`claude plugin validate --strict <独立插件目录>`，未加载模块或模型。补齐作者后warning消失，但旧校验器仍报`hooks: Invalid input: expected record, received undefined`，exitCode=1。没有通过空hooks掩盖此差异；需要兼容宿主重新校验和实际加载。

证据：`output/audit/2026-10-21/claude-installed-manifest-validation-after-metadata.json`、`plugin-preflight-regression.tap`。隔离配置已清理，未升级宿主。

## 交付与下一步

仅重建插件ZIP，并同步候选manifest、SHA256SUMS和[候选交付记录](agent-gateway-candidate.md)。APK与HTML保持原hash，生产仍1.2.2/versionCode18。本次没有插件安装、生产迁移、真实任务/答案/审批、Mac权限或签名变更、Git提交；长期连接测试仍暂缓。

下一阶段优先验收Codex手机原题显示、原会话接收答案、电脑先答/取消及断线恢复，随后完成插件迁移和Android覆盖升级、在线更新、公网与前后台/切网验收。Claude兼容宿主和OpenCode真实服务分别验收，不阻塞Codex自身交付。当前需要用户作出选择时使用聊天正文编号。
