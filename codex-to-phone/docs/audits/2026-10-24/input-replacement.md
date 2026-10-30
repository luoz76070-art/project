# 临时输入转正式输入与旧缓存修复

日期：2026-10-24。当前任务：`.trellis/tasks/10-23-input-mirror-cache/`。

## 用户可见行为

APK35 `1.3.14-input-replacement-preview` 配套新版固定网关：临时输入收到正式身份后更新同一个显示项；已经与临时身份关联的历史记录一起迁移。替换关系保存到缓存，重连、任务结束、重开会话和迟到的旧快照不会重新生成临时副本。草稿、待确认输入、历史分页及实际多次发送的同文输入保留。

这是针对已复现过渡缺陷的修正。此前完整态回放只有一条，并不能排除早期中间态问题；本次实际 App 接入回归证明原缺陷可复现并被修复，手机原记录仍需覆盖安装后验收。没有将合成测试写成真机通过。

## 明确替换关系

- Relay 的原始 `userMessage` 首项声明 `replacesMessageId=turnId-input`；accepted steering 是独立输入，不声明替换。
- 快照附加最多 240 条 `inputReplacements`，仅包含 turn、临时身份、正式 native 身份及已知 client 身份。即使初始输入已被长任务挤出最近 120 条消息，手机仍可修复缓存里的旧别名；不重复传输正文或控制令牌。
- 手机按同 turn、明确 predecessor/native 关系迁移。存在正文或 client 冲突、多个不同正式身份争同一临时身份时保守保留。已知正式正文使用完整正文 trim 比较，不折叠内部空白；仅身份索引缺正文时，只重绑定明确的旧别名，不猜未绑定历史和同文引导的归属。
- 合并保留 source/client/native/turn 身份、历史时间、附件和替换关系。Timeline 的初始输入使用稳定的临时链 key；保守保留冲突项时回退实际 ID，避免重复 React key。
- 缓存身份版本保持 3，加载和保存共用合并逻辑。旧缓存缺关系时等待网关权威信息，已知关系可离线修复。没有清空缓存、草稿、配对或 Key。

索引覆盖最近 240 个有可显示原始输入的 turn。超出范围且缓存中完全没有明确关系的历史不按正文猜测删除；控制协议、历史游标与分页行为保持原有契约。

## 自动与界面验证

- `pnpm test:mobile`：84/84；新增过渡测试 9 项，其中 48 种合法到达顺序逐步检查单次输入数量。
- 实际 App 的 snapshot/delta 更新函数由 TypeScript AST 提取，接真实合并、渲染、缓存和 snapshot reducer。覆盖临时→历史→正式、removedIds、只更新身份索引的 partial、120 条尾窗外、完成/重连/迟到 HTTP、版本 3 缓存、草稿/待确认/附件、缺页及 client/正文冲突。使用合成数据，无真实 HTTP/IPC/模型任务。
- `pnpm test:messages`、两端类型检查、Relay/Mobile 与插件构建通过。
- 后端相关 113/113：native/queue/correctness 60、transport/performance 23、managed gateway/mac service 30。原生投影用例验证长尾 120 条、身份表 240 条上限、索引不含正文及零控制提交。
- 实际浏览器合成会话依次推进历史、正式、长尾、终稿、刷新重开，用户气泡均为 1；独立同文 steering 为 2。草稿始终保持。360/390/430px、深色及 150% 字号无横向溢出，语音按钮 44px 且点击归属正常；无控制台警告/错误、零模型与控制提交。
- Android clean assembleDebug 和完整 lint 通过，0 错误/8 项既有警告；minSdk23 不变。第一次 lint 的路径和第二次的 SDK 环境缺失均保留日志，补齐绝对路径及环境后完整重跑通过，没有屏蔽检查。
- 与 APK34 同签名；APK 中所有 Web 资源逐字节匹配最终 dist，版本/preview APK 源/hot 源正确，无 fixture。

## 网关配套与交付

固定网关 bundle SHA256：`a79f7a9b1eb36f5b21d32a9067b7156b6362ddfa85727e5099db9b11e336f8f6`。切换前新鲜核对单实例、实际入口、配置与上游进程，确认无活动手机待发。原包与配置另存私有备份；仅使用管理 stop，原进程约 2.18 秒自然退出，新实例正常连接 Tunnel。配置/设备/语音凭证/原 DeepSeek 插件与 Harness 进程保持。

本地/公网 86 项只读健康检查通过；公网 Codex、DeepSeek 首次订阅和重连通过。实际 Codex 快照提供 19 条有效替换关系，消息尾窗仍为 120 条；没有代发任务、回答卡片或批准权限。

APK SHA256：`50e43eba84d5b3a150db5adff9e9792fdde9204b0a38b7d693f958dd97dd5b60`，4,069,900 字节。已原子发布 preview35，previous34；公网重新下载 APK 与本地逐字节一致，大小/SHA256/CORS 等 19 项校验通过，正式18与 hot 清单逐字节保持。可在手机 App 内检查更新并下载覆盖安装。完整发布证据见 ignored 的 `publication-check.json`。

证据：`output/audit/2026-10-24/input-replacement/`；私有备份位置保存在该目录 `state-path.txt`，不入 Git。此轮不暂存、提交或推送。

## 真机待验

通过手机“设置 → 版本与更新 → 检查更新 → 下载并安装”覆盖 APK35，保留原连接。重新打开原来重复的会话，观察已有输入是否恢复一条；后续自然使用时核对运行中、任务结束和返回列表再进入均不重复。无需复制长诊断，不需重发之前的提示词。ADB 当前无设备，以上真机步骤尚未验证，任务保持 in_progress。

合成页面结束并重开后的画面（不是手机实测）：

![终稿与重开时单次输入](/Users/rorance/workspace/project/codex-to-phone/output/audit/2026-10-24/input-replacement/final-reopen-390.jpg)

## 更新后当前输入联测（2026-10-24 10:52，上海）

用户报告已更新。对本轮“已经更新。测试一下”在当前会话做只读核对：本地、公网 native 与历史各一条，调用实际手机合并/渲染入口后正反两种到达顺序均一条，source/native/替换关系齐全；14项检查通过，捕获状态为 inProgress。没有代发新任务、回答卡片或审批，未保存原会话正文；报告仅计数及状态，位于ignored的phone-test/result.json。探针初次缺浏览器localStorage替身，修正测试环境后通过，未改产品。ADB仍无设备，尚未直接观测手机DOM，结束及重开后的手机实际显示待用户确认。
