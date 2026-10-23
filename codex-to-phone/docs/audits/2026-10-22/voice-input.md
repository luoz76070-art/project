# 语音输入本地候选

2026-10-22开始，10-23收尾。用户指定百炼Qwen-ASR识别、DeepSeek整理，Key在真实联调时填写。旧DeepSeek追加入口验证继续暂停。

后续2026-10-23已授权并完成固定网关升级与APK26预览发布，preview26/previous25；本地/公网语音配置及84项健康检查、15项公网发布核验通过，真机及供应商仍待验。切换失败/恢复与最新入口见[发布记录](../2026-10-23/voice-release.md)。下文本地候选“未发布”保留为该阶段记录。

## 实现

Codex和Agent输入区共用“语音输入”：仅转文字/整理提示词，Android私有临时M4A/AAC最长120秒、最大2MiB。手动停止与到时结束共用出口；取消、后台、音频焦点丢失、销毁释放录音，启动清理遗留文件。原文/整理稿可编辑；原文改变废止旧整理稿，整理失败仍可采用原文。采用只追加到录音开始时未变化的草稿；草稿冲突提供复制。切连接/Agent/会话或关闭面板取消并丢弃迟到结果，原发送按钮才提交任务。

设置“语音与提示词”保存地域、可选百炼工作空间及两组Key。配置按鉴权设备owner隔离，Mac的`defaultCwd/.mobile-codex/voice-credentials.json`采用0600原子串行写，拒绝符号链接及不安全权限；这是私有文件，尚非Keychain加密存储。手机不持久化模型Key，响应只返回配置状态；留空保留、显式按钮清除，撤销设备取消操作并删除该设备配置。

百炼使用`qwen-audio-3.1-asr-flash`原生同步JSON转写，固定北京/新加坡HTTPS域名，Base64 M4A；DeepSeek使用`deepseek-v4-flash`、关闭思考、非流式有界输出。只发送本段语音/原文，不读取完整历史或项目文件。协议于10月22日核对：

- 百炼：<https://help.aliyun.com/zh/model-studio/fun-asr-flash-recorded-speech-recognition-http-api>
- DeepSeek：<https://api-docs.deepseek.com/api/create-chat-completion>
- Android：<https://developer.android.com/media/platform/mediarecorder>

网关复用鉴权，正文解析前预留每设备1/全局4个请求，转写55秒/整理40秒截止；支持独立cancel、断开响应/撤销/preClose取消。15分钟/1024条有界请求墓碑拒绝重复，不自动重试；取消不承诺供应商停止计费。固定HTTPS地址、不跟随重定向，错误正文不透传，响应最多256KiB、文字最多20000字符，拒绝整理截断结果。

## 验证

- 最终后端332/332，语音11项：`node --test --test-concurrency=2 --test-timeout=15000 apps/relay/tests/*.test.mjs`。
- 手机51/51：`corepack pnpm test:mobile`，包含语音错误脱敏/不重试、响应与草稿边界。`typecheck`、`test:messages`、`test:apk-update`（5/5）、两端及插件构建通过。
- 完整Android lint：0错误/8警告。5项沿用旧包，另3项为未改AndroidX依赖的更新提示；未忽略规则或提高minSdk。
- 合成浏览器：360px深色、390px浅色、430px/150%字号，无横向溢出，按钮至少44px。Codex采用整理稿、DeepSeek采用原文保留已有草稿、仅转文字、整理失败保留原文、模拟权限拒绝、取消迟到丢弃、草稿变化禁用采用、保存后Key输入清空通过。固定返回不代表真实录音/模型效果通过。
- APK身份、26/1.3.5版本、麦克风权限、原生录音类、四个dist文件逐字节、fixture未打包、与APK25同签名通过。

一次默认并行复跑为331/332，既有独立daemon退出测试超出3秒截止，其自建child按原finally清理。独立复核及最终并发2全量通过；未修改该测试或退出逻辑，超时根因未确定，失败日志保留，不据此宣称长期稳定性已验完。

证据：`output/audit/2026-10-22/voice/`，含最终/首次回归、lint、APK核验JSON、可重跑成品脚本及截图。

## 本地交付与待验

APK：`dist-apk/mobile-codex-1.3.5-voice-preview-debug.apk`，versionCode26，4061289字节，SHA-256 `fc9f27131aeba25b3c02ca4bf7f78b5d629e7da701040772ccd5bdbe0f127473`。

独立候选：`output/delivery/2026-10-22/voice-preview/`，含同一APK、`mobile-codex-voice-gateway-preview.zip`、核验JSON。网关bundle SHA-256为`b9c9d22ea020f64e2708700f2b4553eb02f5e0e62f0ae2e2b7da70d6c5697508`，ZIP无用户配置/设备令牌/模型Key。

未切换在线网关、安装APK、改动preview25/previous24与正式18/hot，未调用真实供应商或运行Agent任务。更新网关、安装26后，请用户在手机“设置 → 语音与提示词”填写Key，不在聊天粘贴明文。

待真机/供应商验收：授权拒绝后重试、120秒自动结束、后台/来电/销毁清理、静音/噪声/中英术语/数字否定词、实际模型地域可用性、耗时/费用、切网与两会话隔离。编辑规则要求保留任务边界，真实意图保真仍待样本验证。任务in_progress，不归档。
