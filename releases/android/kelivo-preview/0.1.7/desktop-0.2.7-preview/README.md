# code9 电脑端兼容补充预览：DeepSeek 0.2.7

日期：2026-11-07。适用于现有 Android 0.1.7-native-preview / code9，手机APK及其原源码归档保持不变。此目录单独交付电脑网关和桥接兼容修复；不覆盖上级目录已发布的0.2.6包。

- `mobile-codex-gateway-deepseek-0.2.7-preview.tar.gz`：自包含Node20+网关，增加0.2.2-rc.1精确握手支持，保留code9共享Agent图片/工具/输入协议。
- `mobile-deepseek-0.2.7.tar.gz`：原desktop profile官方Cordis插件；精确支持0.2.1-rc.2、rc.3、rc.5和0.2.2-rc.1，未知版本拒绝。
- `source.patch.gz`：从元数据指定Git基线重建本次电脑运行代码及官方检查器；完整源码仍位于本仓库。`package.json`记录包及逐文件SHA256、源码基线与补丁SHA。`SHA256SUMS`校验全部交付文件。

新宿主配Cordis4.1.0/Node>=24.9.0，旧三版配Cordis4.0.5。原会话身份、排队/停止、内部审批结算指纹保持；修复plan-review可选callId和普通工具结果缺省isError的漏显。新的approval提问intent暂保留电脑处理，不扩展永久授权。

本机已按用户明确授权完成私有备份、原profile离线链接/官方开关重载及固定网关正常切换。未重启Harness或改模型/权限策略，配置及设备保持。本地/公网77检查通过，原会话首屏40消息含14工具记录；图片采用同一公开JPEG的临时文件核对，结束后已删除。后端419、新旧官方各30隔离检查、类型/lint与构建通过；外部模型请求0。用户确认code9已升级、原DeepSeek会话和正文正常；真实发送、审批及图片在手机的实际效果另验。

安装须沿用[原profile配置](../../../../../plugins/mobile-deepseek/README.md)及[固定网关流程](../../../../../docs/ops/version-sync.md)。先备份、核对未决手机输入，使用官方profile插件命令；网关正常stop并确认旧进程退出后start。不能覆盖正在运行的固定程序目录、重新init或用新CLI代替原模型会话。

重建：在元数据指定基线的仓库根目录执行 `gzip -dc releases/android/kelivo-preview/0.1.7/desktop-0.2.7-preview/source.patch.gz | git apply -`（补丁路径可放在仓库外），然后执行 `corepack pnpm install --frozen-lockfile`、`corepack pnpm --filter @mobile-codex/relay build`、`corepack pnpm build:plugin`。构建ID随机，不能承诺bundle逐字节复现。

本项目MIT；此补充不含Kelivo二进制/源码或用户配置、凭证、签名材料。整合App的AGPL/第三方归属见上级版本说明。完整部署与验收见[本轮审计](../../../../../docs/audits/2026-11-07/agent-parity-runtime.md)。
