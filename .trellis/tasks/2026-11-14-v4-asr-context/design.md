# 设计与官方依据（2026-11-14在线核验）

- https://help.aliyun.com/zh/model-studio/improve-asr-accuracy ：默认 qwen-audio-3.1-asr-flash 支持 parameters.vocabulary（文本→整数权重），也支持 input.messages 前置 user/input_text 的上下文增强（每轮400字符，最多5轮）。本轮沿用即时热词，合并固定词表，权重保持1。非ASCII热词最多15字符；纯ASCII最多7个空格片段，超出截断。新加坡子工作空间不支持热词。
- https://help.aliyun.com/zh/model-studio/qwen-audio-asr-http-api ：3.1原生多模态接口、即时词表及上下文请求形状。旧引用 fun-asr-flash-recorded-speech-recognition-http-api 目前描述Fun-ASR，不能再当作3.1依据。
- https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference ：qwen3-asr-flash 兼容chat接口首条system消息可提供背景/实体词表，不是传统角色指令；无vocabulary参数。本轮将固定词表与名称去重后以换行文本放入system.content，仅有会话参考时增加system。

## 最小边界
手机新增asrContext纯函数和preferences；App/AgentWorkspace仅传当前会话已加载数据到VoiceInput。最近20条消息每条最多扫描20000字符，取项目basename、去路径标题和10个文件basename；URL整体排除。asrHints是最多12项字符串数组，含换行分隔符总长≤500 UTF-16单位，不拆代理对。录音开始捕获引用，提交前重读偏好，关闭省略字段；偏好本机存储，异常时保守关闭，内存保存当次选择。参考不进V1待恢复记录。
Relay service schema限制条数/总长度/控制字符/路径字符，摘要纳入asrHints；请求body余量4096以覆盖中文UTF-8。独立asrHints只对明确模型返回参数，未知模型无参数；按有效目标域名判断新加坡，显式workspace或maas域名保守省略词表。固定词表仍为四项低权重，不做自动重试。
改动限语音模块、两个入口、语音测试/驱动、语音契约和本任务文档。不迁模型、不更换凭据、无视觉改版。

## 自审边界
- 新加坡maas域名无法从客户端配置区分默认/子空间，保守跳过热词；宁可缺参考也不因不支持导致识别失败。
- 3.1长标题受15字符/7片段限制，更多内容留给Qwen3的上下文。文件名词法提取不保证覆盖带空格/无扩展名文件。
- 官方网页用匿名HTTP读取；无密钥调用。真机准确性和供应商兼容性留给后续验收。
