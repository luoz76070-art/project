# 百炼协议与独立地址修正 · 2026-10-23

用户授权“按照你的建议进行修正”。APK29 `1.3.8-asr-protocol-preview` 与配套固定网关已发布，preview29/previous28，正式18及hot保持。手机需App内覆盖升级；真实百炼/DeepSeek付费调用、麦克风录音和音质/时延仍待用户验收。旧DeepSeek追加入口联测继续暂停。

## 原因与修正

截图092850显示502、无识别原文。通用502本身不能证明Key或地址错误；源码审查确认初版把31模型错误接到`/audio/asr/transcription`，并错误使用file_url及output.transcription.text。此前隔离测试也镜像了该错误，不能视为官方协议验证。

2026-10-23重新核验官方原始示例并保存HTML到本轮output：

- [31 HTTP参考](https://help.aliyun.com/en/model-studio/fun-asr-flash-recorded-speech-recognition-http-api)：原生多模态generation，input.messages[].content[].input_audio.data，parameters.format/sample_rate，非流返回output.text。
- [Qwen3 API参考](https://help.aliyun.com/en/model-studio/qwen-asr-api-reference)：兼容chat/completions、input_audio.data及asr_options，choices[0].message.content/finish_reason=stop。
- [Base URL](https://help.aliyun.com/en/model-studio/base-url)：支持北京/新加坡业务空间maas域名，原生用同域名/api/v1路径。
- [音频规格](https://help.aliyun.com/en/model-studio/asr-model)：两者列出AAC，Qwen3列表未列M4A。APK29改MediaRecorder AAC_ADTS/.aac，保持16kHz单声道48kbps与120秒/2MiB限制。网关逐帧检查ADTS；旧M4A仅兼容31，Qwen3请求前提示升级，不谎称容器、不偷偷转码。

设置新增独立百炼HTTPS Base URL和两模型选择，接受控制台业务空间URL，按模型派生协议。旧文件无新字段保留31/原地域默认地址；不擅自迁移用户已保存Key到提供的maas地址。更换有效目标，包括切换默认地域，必须同时填对应Key或清除原Key。DeepSeek第三方配置独立且保留。Key不落手机缓存/响应/日志；保存/关闭清空密码框。

错误现在标记百炼语音识别或DeepSeek提示词整理，区分鉴权、地址/模型404、参数400/422、限流429、服务/网络、无效响应和超时。供应商正文不透传、不保存；整理失败原文仍可采用到草稿，不自动发送Agent。

## 验证

- 后端全量356/356；手机54/54；独立打包网关30/30；APK更新5/5，消息回归、两端typecheck/生产构建、插件构建及diff检查通过。全量后端使用test-concurrency=2，隔离临时目录和注入fetch，无真实Key/会话读取或付费调用。
- 双模型测试基于官方非流样例，覆盖同域业务空间/地域、AAC/旧M4A、stop/截断/空语音、阶段错误脱敏、旧文件迁移/有效目标Key绑定，以及原有取消/撤销/并发/墓碑边界。
- 新增手机错误映射测试最初因顶层异步初始化放在注册测试后导致临时目录先被清理；将模块准备移到所有测试注册前后，54/54通过。Android lint先遇相对init路径/缺少SDK环境；补绝对路径与ANDROID_HOME后完整通过，0错误/8项既有警告。不是产品缺陷或真实ASR验收。
- 实际CUA合成浏览器：390px修改百炼地址不填Key明确409；合成Key保存后为空、重开URL和Qwen3回显，DeepSeek保持。360/390/430px无横向溢出，设置控件44px；390px/150%字号正常。合成识别后整理502明确DeepSeek阶段，原文可采用到草稿，未点发送；fixture计数无Agent提交，控制台无warn/error。截图settings-390.png、refine-error-150.png。
- APK 4,064,001字节，SHA256 `1515a82bab3f01ed5f60b1815036f8045f1168249ed2fbd8689f2632452fa951`；与28同签名，4个dist文件逐字节一致，录音/安装权限、VoiceRecorder注册、preview源与双配置代码通过。实际DEX中setOutputFormat参数为6（AAC_ADTS），存在.aac；常量被编译器内联，不能用枚举名字符串存在作为断言。

## 上线与恢复

新固定入口：`/Users/rorance/Library/Application Support/Mobile Codex Gateway/releases/2026-10-23-asr-protocol-8762644e84fb/mobile-codex/lib/gateway.mjs`，SHA256 `8762644e84fbe010c245ca4111c6c0c1d255c4ae5435422f2dd0e2ca3101fb04`。原PID5585按instance stop后2086ms自然退出、端口释放，再启动PID38278，instanceId `1c4c9750-eac3-49c6-a616-502c48499858`，Tunnel connected。原Harness PID68334/68372及profile/插件、配置、设备、语音凭证哈希保持；未重载桥接、未启用自启动。84项本地/公网健康和17项两Agent首帧/重连与队列能力通过，没有发送模型任务或代替审批。

公网完整下载逐字节/SHA/大小/签名对应本地成品、Content-Length/CORS、preview29/previous28及正式/hot字节保持共15项通过。交付目录`output/delivery/2026-10-23/asr-protocol-preview/`；具体公网路径见publication-check.json。正式通道仍18，hot仍1.2.2-web.1。

私有备份：`/Users/rorance/workspace/backups/codex-to-phone/2026-10-23-asr-protocol-20261023T015052Z`。回退前检查后来填写的Key/设备变化，按当前instance停止并分别确认PID和端口释放，才能启动备份原固定程序；不能盲目覆盖新配置。此次脚本绑定本轮state，不能重复执行旧prepare/switch。

## 手机操作

设置→版本与更新→检查更新→下载并安装，确认为1.3.8-asr-protocol-preview。设置→语音与提示词：在百炼API地址填用户控制台提供的`https://llm-8cg31pi710nuq8wo.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，选择该空间已开通的qwen3-asr-flash或qwen-audio-3.1-asr-flash，并重新填写此空间Key后保存；默认空间workspace可留空，以控制台为准。DeepSeek地址/模型/Key使用用户第三方服务商信息。先“仅转文字”短录音，再尝试整理。此配置由用户操作，本轮未代填真实凭证或调用付费接口。

已将核实协议与URL/Key/格式契约更新到`.trellis/spec/relay/backend/voice-contract.md`和手机architecture；复用原发布/备份流程，不另建通用Skill。不暂存、提交、推送、建分支或PR；任务保持in_progress，不把真实验收标成完成。
