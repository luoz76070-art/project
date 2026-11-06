# Mobile Codex 0.1.5 整合预览

日期：2026-11-07。Android `0.1.5-native-preview` / versionCode **7**。

| 产物 | 大小 | 说明 |
| --- | --- | --- |
| [APK](mobile-codex-kelivo-0.1.5-preview-arm64.apk?raw=true) | 60,977,575 字节 | Android 7.0+/API24，Flutter AOT arm64-v8a |
| [对应源码](mobile-codex-kelivo-0.1.5-preview-source.tar.gz?raw=true) | 21,687,913 字节 | 5917 个源码文件，包含5052个固定Kelivo来源文件 |
| [配套网关](mobile-codex-gateway-0.1.5-preview.tar.gz?raw=true) | 334,806 字节 | 自包含 Node 20+ 网关，含本地图片接口 |
| [SHA256SUMS](SHA256SUMS) | — | 下载后按文件校验 |

APK SHA256：`2666d55e30205e60a4b64c23ba36d2fe4b01d9ecd96971fc50267bf1dfd2a316`。
包名 `com.mobilecodex.kelivo.preview`，证书 SHA256 为 `3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38`，与前版code6相同，仍为本地Debug预览证书。

## 安装与本次变化

下载APK后通过Android系统安装器覆盖同包名预览，无需卸载。其他签名的自编译包可能无法覆盖。原独立Codex To Phone是另一包名。

- 执行过程默认收起，连续工具更新同一条摘要；点击查看明细，终稿独立。
- 缩小代码和工具输出，接入Kelivo聊天字号与工具显示偏好。
- 当前Codex项目内的Markdown图片可显示、点击查看大图、切换原尺寸和失败重试。

本地图片读取需要此版网关，限制当前会话项目内栅格图片与8MiB大小；其他Agent本地图片未接入。代码和隔离检查已完成，code7手机覆盖、真实图片联动及59组完整功能仍需分别验收。

## 升级电脑网关

本目录提交不会重启你的电脑服务，也不会上传自托管更新清单。旧网关缺少图片接口，单装新APK不能让它读取本地图片。

将网关归档解压到你选定的长期保存目录。以下 `/permanent/path/mobile-codex` 代表解压后的文件夹；已有自定义配置时，每条命令都附上同一 `--config /absolute/path/gateway.json`。

```sh
node /permanent/path/mobile-codex/scripts/mobile-codex.mjs status
node /permanent/path/mobile-codex/scripts/mobile-codex.mjs service status
```

普通后台网关：先按原配置 `stop`，再从新目录 `start`。不重新init或换workspace，原设备凭证才能沿用。

```sh
node /permanent/path/mobile-codex/scripts/mobile-codex.mjs stop
node /permanent/path/mobile-codex/scripts/mobile-codex.mjs start
node /permanent/path/mobile-codex/scripts/mobile-codex.mjs status
```

若已安装LaunchAgent托管，`start`会继续使用旧固定bundle。需按[托管升级说明](../../../../plugins/mobile-codex/README.md)先停止、卸载本工具自己的服务，再用新目录 `service install`，最后核对普通 `status` 中的running与tunnel。保留旧目录以便用同样步骤回退；不要删除配置、设备、附件或模型文件。上述步骤由使用者执行，本轮未操作在线网关。

手机打开原Codex会话，查看项目目录中的 `![说明](/absolute/project/output/image.png)`，应显示缩略图并能点击打开大图。图片缺失、超限、项目外路径会显示对应原因和重试入口。不要使用真实任务提交来代替取图验证。

## 来源、许可和构建

对应源码包带 `SOURCE-MANIFEST.json`、上游来源、全部文件SHA、AGPL与原MIT和第三方声明。构建入口 `scripts/verify-kelivo.mjs --preview --repeat-tests`；环境见源码包README和[工程构建说明](../../../../integrations/kelivo/README.md)。所有依赖版本/包哈希固定，归档不含SDK、缓存、个人配置或签名私钥。

整合Android程序按[AGPL v3](../../../../apps/kelivo/LICENSE)发行，原Codex To Phone与独立网关保留[MIT声明](../../../../LICENSE)。[源包元数据](source-package.json)、[APK元数据](mobile-codex-kelivo-0.1.5-preview-arm64.apk.json)、[网关元数据](gateway-package.json)记录各自精确SHA。

Git标签：`codex-to-phone-v0.1.5-native-preview`。实际推送OID和GitHub回下载校验由本轮交付回执记录；本目录不代表GitHub Release或稳定版。
