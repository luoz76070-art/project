# 语音服务契约

## 1. 范围

`voice/credentials.ts`、`voice/service.ts`、`server/voiceRoutes.ts`独立于Agent控制。手机录音只生成可编辑草稿，不发送任务。2026-10-23修正百炼协议；旧测试曾镜像错误实现，必须以官方示例建立请求/响应契约。

## 2. 接口

- GET `/api/voice/config`：仅地域/workspace、qwenConfigured/deepseekConfigured、qwenBaseUrl/deepseekBaseUrl、asrModel/promptModel；无Key。
- POST `/api/voice/config`：strict局部更新，新增可选qwenBaseUrl/qwenModel；Key省略保留、null删除，owner仅来自鉴权。
- POST `/api/voice/transcribe`：UUID requestId、规范Base64、durationMs300–121000，最多2MiB；按实际字节识别ADTS AAC或旧MP4/M4A ftyp。
- POST `/api/voice/refine`：UUID requestId、非空text最多20000字符。
- POST `/api/voice/cancel`：UUID requestId，只取消同owner，提前到达记取消终态；已完成结果不被迟到取消改写。
- GET `/api/voice/results/:requestId`：UUID 路径参数，owner仅来自鉴权，`Cache-Control: no-store`。200返回`{status:"not_found"}`、`{status:"processing",requestId}`或`{status:"completed",requestId,outcome,expiresAt,text?|errorCode?}`；outcome为succeeded/failed/cancelled，失败仅固定错误码。匿名/撤销401，非法UUID400。
- 相同owner/ID/输入的POST处理中返回202 processing，完成重放原{text}或原固定错误；同ID不同阶段/内容409 voice_request_conflict。服务层调用共享同一Promise，重放不重新检查已变更的供应商凭证或再次调用供应商。

## 3. 配置与供应商协议

私有文件`defaultCwd/.mobile-codex/voice-credentials.json`，0600原子串行写；拒绝symlink、非文件、超64KiB/损坏及其他用户可读权限。每owner隔离、撤销删除，Key不落手机缓存/响应/日志。当前Mac私有文件并非Keychain加密。

百炼qwenBaseUrl规范为HTTPS同origin的`/compatible-mode/v1`；接受root、完整兼容/chat/completions、/api/v1和完整多模态路径，其他路径拒绝。地域缺省URL为北京dashscope.aliyuncs.com或新加坡dashscope-intl.aliyuncs.com；支持用户maas业务空间域名。旧文件无新字段保持原地域及qwen-audio-3.1-asr-flash，不能自动迁到新域名。workspace非空时独立发送X-DashScope-WorkSpace。

| 模型 | URL与请求 | 非流响应 |
| --- | --- | --- |
| qwen-audio-3.1-asr-flash | 同origin `/api/v1/services/aigc/multimodal-generation/generation`；input.messages[user].content[{type:input_audio,input_audio:{data:DataURI}}]；parameters.format=aac或m4a、sample_rate="16000"；X-DashScope-SSE:disable | output.text，空白为无语音 |
| qwen3-asr-flash | qwenBaseUrl + `/chat/completions`；messages[user].content[{type:input_audio,input_audio:{data:DataURI}}]；stream:false、asr_options.enable_itn:true | choices[0].message.content，finish_reason必须stop |

新APK29原生MediaRecorder.OutputFormat.AAC_ADTS/.aac、单声道16kHz48kbps，DataURI audio/aac。ADTS逐帧检查sync/layer/sample-index/帧长与边界；旧M4A对31使用audio/mp4，Qwen3在请求前拒绝并提示升级，不谎称旧容器是AAC、不自动转码。录音120秒/2MiB，取消/后台/audiofocus丢失释放并删临时文件。

31原生parameters.vocabulary仅携带固定低权重1的手机会话/聊天会话/Codex/DeepSeek，不读会话历史、项目文件或草稿生成上下文。官方即时热词键为文本、值为整数权重；该字段不得传到Qwen3。真实对照发现单词“会话”或“旧会话”提示会误改绘画，禁止将其升级成全局词替换；当前混用同音词仍有误识别，必须保留可编辑原文/预览，不声称完全纠错。隔离测试验证协议及原文保持，真实准确性另记。

DeepSeek默认官方`/chat/completions`、deepseek-v4-flash、thinking.disabled；支持deepseekBaseUrl/deepseekModel，第三方只发通用参数。所有HTTPS URL拒userinfo/query/hash/空白/反斜杠；禁止重定向。响应最多256KiB，文字最多20000字符，整理finish_reason必须stop。

## 4. 验证与错误矩阵

- 更改百炼有效目标（包含地域导致默认域名改变）且已有Key但未替换/清除：409 voice_qwen_key_required_for_url；DeepSeek对应voice_deepseek_key_required_for_url，原配置保持。显式业务空间URL不随地域元数据变化而移动。
- 不支持模型/URL或非法请求：400 voice_invalid_request；非法音频400 voice_audio_invalid；Qwen3旧M4A：409 voice_audio_upgrade_required。
- 供应商401/403→voice_{asr|refine}_auth，404→endpoint，400/422→request，429→busy，其余失败/网络→unavailable，均本地502；坏JSON/缺字段/截断→response_invalid。截止→504 voice_{stage}_timeout。仅固定code，不透传上游正文或异常信息。
- 取消→409 voice_cancelled；成功/失败/取消终态按owner+requestId内存保存，自完成起15分钟，不因查询续期；处理中保留至供应商截止。条数每owner64/全局1024，缓存负载字节每owner1MiB/全局16MiB，处理中预留64KiB，终态按UTF-8文字+512字节固定元数据预算计费；这不是总进程RSS上限。超限在付费调用前429 voice_busy，不淘汰未过期结果。
- 仅缓存输入SHA256摘要与阶段、结果/固定错误、时间和处理控制信息；不缓存音频或Key。先查幂等记录，再限制新操作每owner1/全局4。取消/撤销/停止阻止迟到结果重新写回；voice.revoke清除该设备所有结果，stop清空缓存。Relay重启后结果丢失，不承诺跨重启exactly-once。
- HTTP正文解析前预留每owner1/全局4，preHandler释放解析额度，错误/断开也释放。已受理任务不随HTTP断开取消；显式cancel、撤销、preClose及ASR55秒/整理40秒截止仍Abort上游。供应商网络失败不自动重试。
- 手机每阶段生成UUID并在POST前持久化最少元数据到localStorage：requestId、stage、连接scope、原会话/线程身份、createdAt、草稿SHA256摘要；禁止录音、原文、整理稿、Key/token。存储失败不发起上传。手机以创建时间计15分钟，终态/不存在/过期清除。
- POST结果未知仅GET原ID，按1/2/4/8秒退避；后台暂停轮询，回前台/online立即查询，录音阶段仍取消。原生POST和GET迟到响应仅消费一次。进程重启在应用根部恢复当前连接的所有未过期记录，只GET，不重传、不自动启动下一整理阶段；查不到静默清除。连接切换后不跨scope取结果。
- 正常录音保持预览再采用。失去原面板/进程后的成功恢复按原Codex/Agent线程定位，摘要及写入前比较均通过才追加草稿并沿用既有草稿存储；冲突或保存失败显示可复制结果，不覆盖新草稿。待恢复记录本身不存文字；明确取消清除记录，切会话仅脱离等待、不取消已上传任务。
- V2：有效录音仅由当前 VoiceInput session 的内存引用保留。ASR 非取消失败（含502、超时、恢复failed/not_found及本地恢复期限到期）显示“重新转写 / 丢弃”；用户重转必须生成新UUID，仍走V1单次POST及GET恢复，禁止自动重传或复用已缓存失败的ID。重转在首个await前加锁，连续点击只提交一次。
- ASR成功（整理前）、开始新录音、丢弃/关闭、离开或切换连接/会话、卸载及明确取消均清除录音引用；后台暂停查询不丢弃已上传或失败录音。录音不写localStorage或文件，进程退出后只能按V1取回已提交结果，不能重转已丢失的音频。整理失败继续保留原文、允许重新整理；草稿冲突仍按最初录音时的草稿判断。

## 5. 基准、正常和异常

基准：旧文件继续31/原地域，修正协议后无需迁移Key。正常：手机填写业务空间Base+对应Key并选已开通模型，保存清空Key框，重开回显有效URL和模型。异常：更换地址未给Key时409，旧配置与DeepSeek配置保持；整理失败保留原文，可采用到草稿。

## 6. 验证要求

`corepack pnpm test:voice`注入fetch和临时私有目录，覆盖官方31 output.text和Qwen3 choices、地域/maas、AAC/旧M4A、双阶段错误、URL绑定/旧配置、鉴权/撤销、取消/并发/墓碑与体积。新增丢失响应取同文且每阶段服务商仅调用一次、并发合并/内容冲突、TTL/容量、撤销及迟到结果、后台/进程重启GET-only恢复、草稿隔离与冲突测试。手机decoder拒缺少qwenBaseUrl的旧网关；实际浏览器检查保存/清Key/重开/原文保留。禁止读取真实Key/会话或调用付费模型；运行健康与真机验收分别记录。

V2回归直接触发生产VoiceInput按钮与effect（合成hooks，不替代React DOM/真机），配合生产恢复协调器验证502后同一音频新ID重转、双击锁、重转响应丢失GET恢复、失败/取消分类、内存释放、草稿冲突及重新整理。Relay路由测试验证旧ID重放失败不再调用供应商、新ID成功且供应商总调用两次。

## 7. 易错对照

错误：用`/audio/asr/transcription`+input.file_url调用31，再解析output.transcription.text；或仅把M4A的MIME改为AAC。

正确：先核验每个模型的官方非流样例，再选择上述独立协议；原生输出ADTS，网关按字节识别。官方依据与交付见[百炼修正](../../../../docs/audits/2026-10-23/asr-protocol.md)。
