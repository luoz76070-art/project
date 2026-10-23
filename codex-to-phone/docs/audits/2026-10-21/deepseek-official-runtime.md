# DeepSeek 官方运行时与流式修复复核（2026-10-21）

APK21预览及Mac网关升级后，继续补齐此前只有合成Cordis上下文的加载证据。使用官方发布的`@deepseek-ai/dsh@0.2.1-rc.2`及其依赖，在系统临时目录安装，禁用安装脚本，隔离npm缓存与DSH_HOME。主CLI发布tarball的SHA-512与registry完整性字段一致；依赖锁和版本元数据保存在本地`output/research/2026-10-21/deepseek-official-runtime/`。没有全局安装dsh或修改用户profile。

新增手动检查入口：

```sh
node scripts/check-deepseek-runtime.mjs /absolute/isolated-official-runtime
```

入口要求预先准备的官方隔离运行时，含同版`@deepseek-ai/dsh-agent-loop-testkit`及Cordis4.0.5，自己不访问外网或安装依赖。它复制源码插件至新临时目录，以官方API初始化测试profile；CLI只运行`--dump-config`。第一部分装载官方Loader、AgentRegistry、SessionStore和SessionQuery，仅驱动handle合成；第二部分创建独立Context，通过官方testkit装载生产AgentLoop及其依赖，只登记本地确定性LLM adapter，不连接外部provider。所有会话限自建Context，配置0600、随机loopback端口及密钥；退出时关闭订阅、卸载Context并删除自建目录。

13项检查通过，其中原9项加载检查：

- 官方版本门接受固定版本，拒绝不匹配版本；bundle解析与CLI配置合成包含插件。
- 缺少依赖时插件等待，依赖就绪后官方Loader加载成功，`/info`及空会话列表正确。
- 官方内存会话/registry/query与作用域事件总线能传递一次合成输入并确认，仅调用合成handle一次。
- 官方作用域流事件传递中文文本和运行状态，推理正文未进入可见消息，废弃输出清除。
- SessionQuery卸载后插件回到等待并关闭端口，恢复服务后重新加载；Loader异步卸载后端口再次关闭。

追加的4项使用实际生产AgentLoop：

- 手机桥接queue进入原fixture Agent，一次user/message权威确认，输出未完成时即可看到正文和outputting状态。
- steer在同一turn追加输入，产生下一段本地响应；段末权威消息替换临时文本，首段只保留一条。
- interrupt让原任务结束并确认，宿主Inbox中已排队的输入保留；脚本随后只移除自己构造的该条输入。
- 新任务开始后，旧turn令牌中断返回409/DEEPSEEK_STALE_CONTROL，新任务继续运行；有效令牌可以中断。

实际AgentLoop检查首次在queue阶段超时：消息已确认、fixture响应已开始，但桥接未展示正文。固定官方运行时的AssistantStreamAttempt在start/chunk/end每帧调用nextRevision；插件却要求chunk的revision等于start，导致所有正文帧被丢弃。此前合成fixture也错误地固定revision，未暴露该缺陷。先用逐帧递增回归复现失败，再修正插件为已接受revision单调递增，并同时匹配attempt和index；旧start、重复/乱序chunk和旧attempt终帧均拒绝且不推进水位。现有两项流fixture同步修正，新增回归验证后共22/22通过。

插件版本递增至0.1.1，修复只涉及宿主插件的流投影。APK21和正在运行的固定网关无需更换；修复插件另存独立本地候选，原已发布ZIP/APK及部署证据保持原值。用户dsh尚未安装或加载本插件。

本地候选为`output/delivery/2026-10-21/deepseek-stream-fix/mobile-codex-deepseek-0.1.1-stream-fix.zip`，9,932字节、SHA-256 `2ef0886e772ed15098865bc29bcab7574e85cfbb5830d1afd249d8422ac47834`。包内6个文件逐一匹配源码/构建目录；新构建网关bundle与已发布原ZIP完全一致，原交付三产物hash再次核对通过。manifest和SHA256SUMS位于同目录，状态明确为未发布、未安装、用户原会话和Android未验收。

加载检查自身另按官方契约修正两点：Cordis的FiberState是无JS导出的const enum；直接构造的Session可见消息必须携带surfaceOp。未通过降低断言或跳过官方服务消除失败。

证据：`output/audit/2026-10-21/deepseek-official-runtime.json`包含13项结果、3次本地响应/0次外部模型请求、脚本/插件/官方AgentLoop文件hash及最终依赖锁hash；先前9项记录保留为`deepseek-official-runtime-loader-only.json`。`deepseek-official-runtime-preflight.json`保存官方主包完整性和临时依赖清理状态；`deepseek-stream-fix-regression.tap`为22项回归及Relay构建结果。检查器与插件语法、独立插件构建及新ZIP逐文件核对另记。产品修复限独立DeepSeek插件，未重跑整套248项或手机构建，不改正式更新通道。

这是隔离官方运行时及生产AgentLoop验证，仍不是用户dsh原进程或真实模型服务验收。前置核对未发现全局dsh，ADB为0台设备；手机APK21版本及空白工程测试会话已向用户询问。用户dsh原会话/真实provider、Android覆盖安装、手机去重和网络恢复仍待完成；长期测试按用户要求暂缓。整体目标和Trellis任务保持进行中。
