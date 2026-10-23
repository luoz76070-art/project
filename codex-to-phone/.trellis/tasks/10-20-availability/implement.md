# 实施与检查

2026-10-21最新：沿用用户既有切换授权将0.2.0候选固定网关上线，私有备份、首轮正常回退及二次切换、公网/本地鉴权、配置/设备状态保持与v1真实只读增量流通过，见`docs/audits/2026-10-21/agent-compat-runtime-upgrade.md`。未启用后台托管；Android、原会话写入与登录/唤醒仍待验收，长期测试暂缓。

2026-10-21后续：原生插件网关补齐可选macOS后台托管源码，替代仅覆盖旧App的自启入口缺口；26项隔离/独立Node/plutil检查与本地插件0.2.0候选已完成，详见`docs/audits/2026-10-21/gateway-service.md`。当前未注册实际登录项，真实登录/异常恢复/唤醒与Android验收继续待办。

- [x] 串行输入事务、独立请求文件、未知结果禁止重发，注入测试。
- [x] 进程监督/退避/唤醒探测、日志权限与轮转、自启脚本及 Swift typecheck。
- [x] 配对/持久设备哈希/撤销、SSE 限额与鉴权日志回归。
- [x] Android Keystore 与明文迁移，HTTPS 策略与前端连接界面。
- [x] 原子发布、回滚说明和隔离检查；真实平台验收留待用户。

## 源码检查结果与剩余验收

2026-10-20 本轮源码/隔离检查完成，证据见 `docs/audits/2026-10-20/delivery.md` 与 `optimized-evidence.json`。源码检查阶段未部署；后续用户另行授权的公网修复记录如下。未执行提交。

- [ ] Android/真实 Desktop/睡眠恢复等适用平台验收；未通过前保持任务 in_progress。

## 首次手机实测反馈

2026-10-20 用户报告公网连接失败。初次只读检查确认域名证书已过期、Broker 无已连接 Relay、Mac/Broker 仍运行旧版（Mac `/api/connection` 为 404）。用户随后明确授权执行，已修复 TLS、启用续期并通过 dry-run，按 Broker → Mac Relay 顺序切换。详见 `docs/audits/2026-10-20/connection-repair.md` 和 `output/audit/2026-10-20/connection-repair-result.json`。

- [x] 用户已授权线上变更，完成备份、TLS/续期、Broker 与 Mac 切换；本地/公网鉴权 200、无凭证 401、Android 预检 204、在线 Relay 1。
- [ ] 用户在手机重新测试完整 Remote Endpoint；真实控制与网络切换单独验收。

## 输入权限与长期连接确认

- [x] 截图错误定位至辅助功能检查；本地/公网鉴权只读检查均为 200。
- [x] 真实手机请求 TCC 责任归属为 Relay；修正只授权 Input 的说明，记录开发工具探测的归属差异。
- [x] 核对心跳/空闲截止/重连/前后台与唤醒源码；用户选择暂不开长期测试。
- [x] 用户已重新添加当前 Relay/Input 授权。系统日志在北京时间 21:48:24/21:48:45 分别记录 Allowed，授权 cdhash 与当前工程两个 App 匹配；运行中的 Relay 路径正确，本地/公网连接检查均为 200、authenticated=true。
- [ ] 用户在手机手动发送一次验证；未以开发工具空请求代替真机验收，未自动重发消息或启动长期测试。
