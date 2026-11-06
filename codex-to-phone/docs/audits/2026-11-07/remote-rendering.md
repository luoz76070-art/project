# 电脑页执行摘要、图片与GitHub预览交付

日期：2026-11-07。范围来自用户真机反馈：执行日志/代码过大且每次占行、电脑图片未显示、README优化并向现有GitHub提交源码与APK。沿用同一Kelivo整合任务；59组完整验收不因此结项。

## 实现结果

- 同轮过程默认收起，运行中显示最新工具动作和数量；连续增量保持同一摘要与用户展开选择，完成后收起。失败数量直接显示在摘要；停止且无终稿显示“执行记录”，不会永远转圈。终稿、审批、提问及用户输入保留既有分组边界。
- 电脑正文默认15px、代码12px、工具输出约11px。长输出在块内滚动；Flutter SettingsProvider通过宿主外观快照传递聊天字号、显示工具卡和工具结果摘要偏好。未重复建立一套设置。
- `POST /api/threads/:threadId/images`复用设备鉴权，从线程摘要取得项目cwd。realpath校验项目范围、拒绝符号链接越界、限制8MiB并按图片魔数识别栅格格式；有界读取、全局4/每设备2并发和no-store响应。客户端不传任意cwd，不把凭证放URL。
- Markdown图片支持本机/相对/编码/file路径，经API取data URL；HTTPS图片独立加载。缩略图按需加载，可点开大图、切换原尺寸、关闭与重试。切会话卸载/Abort和迟到回执保护由当前provider绑定负责。SVG、非图片、危险URL及项目外文件拒绝。本地取图目前只支持Codex会话。
- README使用居中介绍、下载表、实际合成界面截图、独立功能说明、连接/构建与许可，替换过时的版本堆叠；历史详细记录沿原docs保留。新增版本目录仅在用户本轮明确要求下纳入APK例外，其余缓存/安装产物仍忽略。

## 检查与证据

| 检查 | 结果 |
| --- | --- |
| 最终 `corepack pnpm verify` | 通过；入口8、手机161、后端407，消息、更新、发布片段与其他步骤通过 |
| Dart root与markstream `analyze --fatal-infos` | 通过；变更Dart格式0修改 |
| Flutter `test --no-pub test/product` | 11/11通过；本轮未重跑Flutter/markstream全量 |
| Android强制复跑原生测试 | 340/340，0失败/错误/跳过，39 suites |
| 完整宿主/远控 `lintRelease` | 0 Error/Fatal，保留56/1条既有Warning |
| 最终 `verify-kelivo --preview` | 成功；APK身份、版本与apksigner通过 |
| 包内Web与成品检查 | 5个Web文件与最终build逐字节一致，无fixture/runner，arm64 Flutter AOT存在 |
| 源码归档回读 | 5917个源码文件、5922项归档，5052个固定来源全部保留；逐项字节一致 |

隔离后端测试使用临时目录/假store/合成HTTP，覆盖路径、编码、链接、格式/大小、缺失、鉴权和设备撤销，不读取真实会话或提交任务。渲染测试覆盖40次工具折叠、终稿、停止、失败提示、图片语法和危险URL；偏好测试直接执行生产apply函数。

浏览器为独立 `127.0.0.1:56408` fixture：20→40次执行仅1摘要、默认不挂明细、增量保持展开选择、点击收起；完成后图片实测naturalWidth720、正文15px/代码12px，大图原尺寸720px；404说明→手动重试→图片恢复。360/390/430宽度、深色、150%系统字号叠加1.5聊天倍率均未出现页面横向溢出；关闭工具卡偏好后过程隐藏，最终回复/图片保留。截图[浅色](../../images/remote-rendering-light.jpg)、[深色](../../images/remote-rendering-dark.jpg)均为合成数据；不充当手机原生验收。

本机日志与原始报告位于 `output/audit/2026-11-07/remote-rendering/` 和 `/tmp/codex-phone-20261107-*.log`。首次Flutter测试误用默认PUB_CACHE导致镜像缺包，指定既有缓存后通过；首次签名校验子进程未继承已选择JDK，修正脚本env后正式入口通过；初次浏览器夹具凭证为空导致401，修正合成vault后通过。APK曾被过强断言误判要求所有依赖so仅arm64，核实Flutter AOT仅arm64、部分上游依赖保留其他ABI后修正检查。早期失败记录保留，不将这些检查错误表述为产品已修复缺陷。

首次整合源码入库的暂存差异检查报告9288处既有空白格式提示；全部来自导入Kelivo。其中9287处文件SHA与固定上游完全相同，剩余MainActivity文件与前版code6对应源码逐字节一致。本轮新增/自有变更未出现差异格式错误；保留上游来源字节，不作无关全库格式化。详情为本机 `git-diff-check*.{log,json}`。

## 交付物与范围

[版本目录](../../../releases/android/kelivo-preview/0.1.5/)：

- APK：`0.1.5-native-preview` / code7，60,977,575字节，SHA256 `2666d55e30205e60a4b64c23ba36d2fe4b01d9ecd96971fc50267bf1dfd2a316`。
- 源码：21,687,913字节，SHA256 `d94bd7999e878cb6c2f1e00c0dbf3093263e1b74bd7c3c3b39d47175421b067c`。扫描0个未审核高可信凭证模式，13处固定上游合成Key精确允许；另对Git候选文件名与23处凭证样式赋值进行复核，均为测试/占位文本。扫描不等于普适无秘密证明。
- 配套网关：334,806字节，SHA256 `5bfe4c82b0f867bf7ea61cf2421078ca634c57cdc086d5e118a8b89622166550`，包含新图片路由；归档内bundle回读一致，独立help成功，无个人配置。源码归档补齐全部plugins，使build:plugin三个分包输入齐备。
- APK证书SHA256 `3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38`，与前版code6一致；仍为预览证书。

Git沿现有 `luoz76070-art/project` 的main，仅提交 `codex-to-phone/`；开工暂存区为空，fetch后远端领先0，本机原4个未推送提交逐个仅属本项目。既有Kelivo/宿主等未提交源码随本轮建立整合预览基线，父仓库其他工程不带入。标签 `codex-to-phone-v0.1.5-native-preview`；最终远端OID、APK/源码/网关全量回下载大小与SHA以及源码与tar逐文件匹配，记录在本机 `output/audit/2026-11-07/remote-rendering/github-verification.json`，用户交付回复同时提供链接。

本轮未升级在线电脑网关、未更新自托管APK清单、未创建GitHub Release、未执行真实模型任务。新APK配旧网关不会具备本地取图能力，需按版本README升级配套网关。code7手机覆盖安装与真实图片联动仍待复测；全功能59组、最低系统/系统插件、其他Agent本地取图均不宣称已完成。

复用了正式验证入口、原APK签名/安装机制、来源清单及对应源码脚本；版本目录与Git范围例外写入 `docs/ops/version-sync.md`。未新增自动化或通用skill。下一轮有明确验收步骤的接续见[手机复测计划](../../plans/2026-11-07-remote-rendering-device.md)。
