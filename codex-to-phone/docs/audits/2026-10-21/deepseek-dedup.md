# 手机重复修复与 DeepSeek Harness 预览交付（2026-10-21）

用户确认本轮输入来自手机，记录一次真实发送成功；实际APK版本尚未核对，不能据此认定全部原生操作、问答或长期连接已验收。随后手机出现重复显示，已优先修复；新增Agent明确为DeepSeek官方Harness/CLI。

## 消息重复

根因是HTTP发送返回后直接追加本地占位，SSE权威消息可能先抵达；旧匹配依赖同文、两分钟时间窗及中间没有助手输出。Desktop投影又丢弃了clientUserMessageId，长任务/时钟偏差使重复难以消除。

现在HTTP回包和同步事件统一合并；用户消息优先按clientMessageId关联，兼容旧desktop-local-ID缓存。即使正文相同也保留新关联ID和附件；两次不同提交ID的同文消息仍显示两条。原生投影保留身份，仅accepted steering作为已接收用户消息，不改变真实执行次数或自动重发。

回归先复现迟到回包产生第二条，再验证HTTP/SSE两种顺序、时钟偏差、助手夹入、旧缓存、附件和独立同文提交。390px合成界面：两次独立提交显示两条，刷新后仍两条，输入框清空，无warn/error和横向溢出；只使用假会话。截图位于本地output/audit/2026-10-21/phone-dedup-390.jpg。

## DeepSeek 原进程接入

固定官方提交 `687f282e8625c6b8d11ff58211a90524be2e4317`、版本0.2.1-rc.2；研究记录见当前task的research-deepseek.md，源码入口为`plugins/mobile-deepseek/`及`apps/relay/src/agents/deepSeek*`。

插件加载于原dsh进程，仅操作已有live Agent；通过独立密钥的127.0.0.1 HTTP/SSE接网关。手机沿用原有Agent鉴权/配对/订阅路由，新增DeepSeek入口和隔离草稿。支持最近文本、可见文本流、运行状态、排队、当前任务追加和中断；不创建/恢复会话，不需要新增辅助功能授权。

控制绑定原live实例与任务边界；同步预留后才调用宿主，原user/message确认输入。未知锁定，断流不重放；权威拒绝解锁。UUID别名避免把任意宿主会话ID放入HTTP路径。没有手机时不读正文；首次按需观察，4096事件及以上不复制全log，只同步后续增量。较小日志的官方events API仍会首次物化，不能宣称任意长会话内存恒定。文本/消息、帧、连接及待确认项均有界，200ms合并；慢端按1MiB缓冲关闭，而不是看到write返回false就断流。

初期不支持附件、历史分页、手机问答或审批，界面明确说明；中断的原任务结束可确认，但不保证一定由取消导致。重启插件/网关不承诺跨重启exactly-once。本机未发现dsh，没有安装/升级宿主或运行模型，官方加载和原会话实测仍待完成。安装/config/卸载见[DeepSeek插件说明](../../../plugins/mobile-deepseek/README.md)。

## 本地交付与验证

候选目录：`output/delivery/2026-10-21/deepseek-dedup-preview/`。APK21为1.3.0-deepseek-dedup-preview，4,036,386字节，SHA-256 `09da3fda0b5d60e806153ff405303d0cc42c9376cba1e632db27c7d45ffb8e12`。应用ID、签名和权限与20一致，v1/v2通过，双更新源保留，全部4个dist文件匹配且没有旧hash残留。单HTML366,880字节，SHA `4ad1b6ffb5103026d318114e8d4f057c320f9b083c5635f85fb856a45fc4f677`，仅兼容原生21。

三插件独立ZIP339,565字节，SHA `76d651a506acfc722fd49d458614f4dc4fb3253ec2d86d0f97ef73e6785cf0df`，包含mobile-codex、mobile-claude、mobile-deepseek与隐藏marketplace。未自动安装任何宿主插件。完整manifest、SHA256SUMS及校验JSON位于同一候选目录。

- 综合后端248/248通过；最终补充配置脱敏/空Origin及关闭幂等后，受影响DeepSeek21/21通过。Desktop原生控制20项已包含在综合检查中。
- 手机42/42、消息回归、两端类型检查/生产构建、独立三插件构建、热更新路径及单文件构建回归、发布片段4项通过。没有单独lint脚本。
- 浏览器合成DeepSeek入口、列表、一次模拟发送和运行状态通过；360/390/430px无横溢，按钮至少44px，warn/error为空。浏览器不能代替真实Harness或Android。
- 复用既有Trellis、具名APK、独立插件、双更新源、签名/资源核验及发布脚本；没有新增常驻自动化或改动Mac App签名/权限。

## 预览发布与网关升级

部署认证恢复后，按用户原授权完成发布和网关升级。服务器现有Broker服务与部署目录核对一致；先私有备份原预览清单，再复用原子发布脚本上传APK21，仅切换`android/preview/latest.json`。公网完整下载HTTP200，4,036,386字节、SHA-256与上述本地产物一致，Android Origin的CORS返回`*`。正式Android18及hot清单的SHA在发布前后保持一致；未修改Broker、证书或防火墙。

手机用浏览器打开[APK21预览下载](https://zyzlz.xin/mobile-codex/releases/android/preview/mobile-codex-1.3.0-deepseek-dedup-preview-09da3fda0b5d.apk)，直接覆盖安装并保留App数据，进入“设置 → 版本与更新”核对`1.3.0-deepseek-dedup-preview / 21`，再使用原连接。由于正式清单仍18，普通“检查更新”不会提供这个预览。既有更新入口和双更新源保留；21的HTML仍只是本地产物，没有推送到旧原生版本。

Mac切换前，私有备份原`gateway.json`、固定运行版本与运行日志，并核对实际监听进程。`devices.json`原本不存在，鉴权设备列表为空；保留该状态，不虚构设备文件备份。ZIP校验后展开至新的固定版本目录，使用旧实例自己的鉴权CLI停止，再用新固定CLI启动；配置文件逐字节未变，原Token、端口、workspace与Tunnel凭证保留。旧进程已退出，当前仅一个loopback监听者，旧Mac App及辅助功能权限未改，宿主插件没有自动安装。

切换后本地及公网`/api/connection`鉴权均200，未认证均401；Android Origin OPTIONS均204且允许认证头。两端`/api/gateway`确认同一新实例、native方式及connected Tunnel；只读Desktop健康检查为`desktop-ipc-follower-control`且IPC已连接。运行包文件hash与已校验ZIP中的同一bundle一致；没有发送模型消息、答案、审批或中断。短流程健康检查不代替实际流式显示和手机写入验收。

私有Mac备份为`/Users/rorance/workspace/backups/codex-to-phone/20261021-140253-deepseek-dedup-upgrade`；新固定目录为`/Users/rorance/Library/Application Support/Mobile Codex Gateway/releases/2026-10-21-76d651a506ac`，旧固定目录继续保留。回退可用新目录CLI鉴权stop，再用旧目录CLI start；配置无需恢复，实际故障回退未演练。未新增系统自启动，Mac及网关仍须在线。

脱敏证据：`output/audit/2026-10-21/deepseek-dedup-publication-before.json`、`deepseek-dedup-publication.json`、`deepseek-dedup-gateway-upgrade.json`与`deepseek-dedup-server-check.json`；交付manifest已更新发布/网关状态。复用[既有迁移运维流程](../../ops/remote-connection-repair.md)，补充首次设备配对前设备文件可不存在的核验规则，没有新增常驻自动化。

Android覆盖安装后的消息去重、真实DeepSeek及其它Agent控制、问答/两端先答、切网与前后台恢复仍需实测。DeepSeek的网关代码已升级不代表本机已安装或配置dsh。长期连接测试继续按用户要求暂缓。源码未暂存/提交/推送，任务保持in_progress。

后续[官方运行时复核](deepseek-official-runtime.md)已补齐13项：9项加载及生命周期，加官方生产AgentLoop的4项控制/流验证。真实驱动暴露revision逐帧递增契约错误，已先复现再修复为插件0.1.1，DeepSeek回归22/22；外部模型请求0次、本地响应3次。修复插件单独本地打包，原已发布三插件ZIP、APK21与运行网关保持本次交付的hash。该检查不代替用户dsh原会话/真实provider及Android实测。
