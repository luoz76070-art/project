# Mobile Codex 0.1.7 整合预览

日期：2026-11-07。Android **0.1.7-native-preview / code9**。

| 产物 | 说明 |
| --- | --- |
| [APK](mobile-codex-kelivo-0.1.7-preview-arm64.apk?raw=true) | 60,978,859字节，Android7.0+/API24、arm64 AOT |
| [对应源码](mobile-codex-kelivo-0.1.7-preview-source.tar.gz?raw=true) | 21,701,513字节，5921源码文件；5052固定Kelivo来源全部包含 |
| [电脑网关](mobile-codex-gateway-0.1.7-preview.tar.gz?raw=true) | 自包含Node20+固定程序，含全部Agent图片路由/投影 |
| [DeepSeek桥接0.2.6](mobile-deepseek-0.2.6.tar.gz?raw=true) | 官方原进程插件，原生/PTC可见工具投影 |
| [Claude模块0.1.2](mobile-claude-0.1.2.tar.gz?raw=true) | 需兼容Mods宿主，原工具投影 |
| [SHA256SUMS](SHA256SUMS) / [网关与插件元数据](gateway-package.json) | 大小、归档及逐文件SHA；不含个人配置 |

APK SHA256：`2906505998d00021252aac5ec1dcb44c62ae09fe939ab7c38bb2f8912bd3c4ed`。包名`com.mobilecodex.kelivo.preview`，与code8同预览证书`3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38`。

## 手机变化与更新

Codex、DeepSeek Harness、Claude Code、OpenCode共用当前Codex的消息/说明/工具动态摘要、输入、图片大图、附件、语音和主题字号；未来通道通过标准SessionAdapter及sessionApi:1复用。执行说明直接显示，详细命令与输出点击一次展开，终稿独立。纯文本工具输出也可展开查看。按钮由原通道能力决定，Claude不启用引导；未知提交不重发，附件草稿独立保存，上传/存储失败阻止离开。

code6/7/8从「设置 → 应用更新 → 检查更新」升级；code4/5先手动覆盖一次，不要卸载。独立App源同步code9，previous保留8。手机实际覆盖安装及原宿主联动尚待用户确认；code8已通过的效果不等于code9真机验收。

## 电脑端配套更新

单装APK无法补充旧插件的工具记录或旧网关的Agent图片路由。先保存原长期目录/配置/设备及插件版本，确认没有未决手机输入；沿既有网关status/stop/start流程切换本目录新固定包，不重新init或换workspace。托管服务按[网关说明](../../../../plugins/mobile-codex/README.md)升级其固定入口，不任意结束进程。候选网关bundle SHA256：`61052038efcb1edad8a98e08de68a73cfc11c779b1f42bb5298bf2ea8523ae89`。

DeepSeek沿原Harness profile链接/加载0.2.6，实际鉴权`/info`须出现toolMessages:1。只重载原手机桥接，不停原宿主或任务；不能以磁盘文件版本代替已加载版本。Claude原进程需支持Mods（官方下限2.1.287）并加载0.1.2，本地旧2.1.220未升级；OpenCode保持固定2.0.16原接口，无需新增手机插件。所有可见输出只从原宿主官方事件/快照投影，不启动替代模型或会话。

本机当前仍运行旧网关，DeepSeek桥接离线，Claude/OpenCode未配置。此处交付的是可审阅候选；在线网关及原插件切换按[版本同步边界](../../../../docs/ops/version-sync.md)单独确认后执行。真实发送/审批/停止由用户选择原测试会话分项验收。

## 验证与许可

完整verify手机169/后端414/入口8全部通过；原生340项、完整lint0错误（宿主56/远控1既有警告）；5个Web文件匹配成品，原生7插件和arm64 AOT保留。四通道/未来通道隔离浏览器检查、DeepSeek官方rc.2隔离检查及Claude官方严格validate和8项沙箱测试通过；未发真实模型任务。未改Flutter业务，不重复其全量；59组完整Kelivo及原Desktop新建继续待验。

对应源码含全部锁、构建脚本、AGPL与原MIT及第三方声明；不含缓存/配置/凭证/签名私钥。构建入口和来源见[整合说明](../../../../integrations/kelivo/README.md)。自身签名不能承诺同签名覆盖或APK逐字节复现。Git预览标签`codex-to-phone-v0.1.7-native-preview`，检查及双源回执见[本轮审计](../../../../docs/audits/2026-11-07/agent-parity.md)。
