# Codex 问答回包核验（2026-10-21）

## 问题与修复

原题应答检查了连接代次、success和owner，但没有检查响应method或有效结果。合成临时socket确认错误method、错误内层method、空结果、负面结果和异步错turn共9种情况会误标submitted；另外2种错误owner用例原本就会拒绝。复现记录为`output/audit/2026-10-21/codex-question-ack-before.tap`，当时15项中6通过、9失败。

DesktopControl.respondUserInput现在记录本次方法，检查outer method/owner和可选内层method，同步题要求ok=true，异步steer要求返回原题turnId。检查方式复用已有普通控制和审批的结果解包模式，未增加接口或依赖。错误/缺失结果标为uncertain，保留未确认原题锁，不重发或回退新任务。

同代次权威状态已移除题目时，迟到的无效回包或传输错误不能将已处理状态变回未知；resolved表示原题不再待答，也可能是电脑先答或任务结束，不能单凭它证明手机答案被采纳。合法ACK最多submitted，仍等原会话状态确认。

只读检查当前安装包主源的submit-user-input v1、steer v1处理和已有NativeControl/Approvals用法；不修改安装目录，也不连接真实会话发送答案。提取目录沿用前轮的被忽略研究输出。

## 验证

新增17项，问答回归44/44，合并后端227/227；两端类型检查、Relay及独立插件构建通过。新增用例覆盖同步/异步的错误方法、错误owner、错误内层方法、空/负面结果、异步错任务、合法平面/包裹ACK，以及权威移除早于无效回包；每次未知提交保持锁定且socket写入仅1次。

第一轮综合回归226/227，唯一失败是Claude旧超时测试：一次轮询可能在墙钟截止前稍早返回pending，契约允许宿主再次轮询。仅修改测试按同一原请求继续有界等待，保留closed终态、过期后回答拒绝和原题不复活断言；未改Claude运行逻辑或生命周期。修正后综合回归227/227。日志分别为`codex-question-ack-regression.tap`和`codex-question-ack-regression-final.tap`，位于上述audit目录。

## 交付边界

仅重建插件ZIP，同步[候选产物](agent-gateway-candidate.md)的manifest/SHA256SUMS与说明；APK/HTML及生产1.2.2/code18保持原文件。当前真实问答提交、电脑先答/取消、实际插件迁移与Android公网仍待验收；没有真实模型任务/答案/审批、宿主升级/安装、生产部署、权限或签名变更、Git提交，长期连接测试暂缓。
