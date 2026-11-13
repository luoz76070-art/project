# 旧 Mac 应用清理与当前网关位置

日期：2026-10-21（Asia/Shanghai）。用户明确要求定位后台网关并清理不再参与当前控制的Relay/Input应用。

## 当前运行入口

原生网关程序：`~/Library/Application Support/Mobile Codex Gateway/releases/2026-10-21-question-lifecycle-6efac3ab10aa/mobile-codex/lib/gateway.mjs`。

- Node：`~/.local/node-v22.22.1-darwin-arm64/bin/node`。
- 配置：`~/Library/Application Support/Mobile Codex Gateway/gateway.json`；含私有凭证，不打印正文。
- 日志：`~/Library/Application Support/Mobile Codex Gateway/gateway.log`。
- 监听：`127.0.0.1:8787`，PID83844，独立后台进程，native Desktop IPC与Tunnel connected。
- 管理：固定包内`scripts/mobile-codex.mjs`支持`status/start/stop/pair`。此处实际Codex插件尚未安装，直接运行同一份固定网关程序。

当前未注册`local.mobile-codex.gateway` LaunchAgent，网关尚无登录自启动；日后启用须按插件的显式service流程。其工作目录仍为原工程，以保持设备与附件位置。

## 清理内容与恢复

工程根目录的`Mobile Codex Relay.app`和`Mobile Codex Input.app`均为未入Git的生成文件。已核对bundle ID、没有符号链接或运行进程；旧`local.mobile-codex.relay` plist不存在，launchctl明确返回未加载。

两个App共6个文件、316741字节，先归档到工程外0700备份目录中的`legacy-mac-apps.tar.gz`（0600），核对所有目录/文件、SHA和权限，再移除原App。归档绝对路径及SHA保存在`output/audit/2026-10-21/legacy-mac-app-cleanup.json`，归档旁manifest保存原始文件树与受保护文件哈希；不留下可误启的同名App副本。

Swift源码、`mac:helper`/`mac:relay-app`/`mac:package`等构建命令、旧配置与日志、设备状态及既有固定发布均保留。没有改动系统辅助功能授权、安装插件或启用自启动。若需旧版回退，先正常停止当前网关、确认端口释放，再将压缩包中的两个App恢复到原工程目录并核对归档manifest；原生与旧版不能同时启动。

## 验证结果

清理前后固定bundle/Node/网关配置/旧配置和设备文件状态一致；仍为同PID与同instanceId，未重启网关。本地及公网`/api/connection`鉴权200，`/api/gateway`200且Tunnel connected，Desktop health为200、native follower及IPC connected。没有发送模型任务、答案、审批或中断。

系统后台项目的`sfltool dumpbtm`只读检查超过10秒截止，已终止该检查并记unknown；不据此声称完整登录项清单为空，也未修改未知项目。两项已知LaunchAgent均已独立核对。

仅生成应用与文档变化，无业务源码或接口变更；验证为归档完整性、源码/构建入口存在性、实际运行状态与本地/公网只读检查，不重跑无关构建或模型验收。本次复用既有公网维护流程，并补充旧App清理/回退步骤到`docs/ops/remote-connection-repair.md`，未新增Skill或定时自动化。
