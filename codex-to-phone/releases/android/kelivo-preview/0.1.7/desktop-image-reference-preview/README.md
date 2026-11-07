# code9 电脑网关：隔离副本图片修复预览

日期：2026-11-07。修复助手明确引用的图片保存在原项目之外时被错误拦截。Codex和全部电脑Agent共用精确文件授权；项目内规则及大小/格式/鉴权保留。手机继续0.1.7-native-preview/code9，DeepSeek插件继续0.2.7，不需要重装App。

- `mobile-codex-gateway-image-reference-preview.tar.gz`：本次自包含Node20+网关，bundle SHA256记录于package.json。
- `source-overlay.tar.gz`：10个修改/新增源码、测试与契约文件，基线为`a3c2052c6d3438420f16d173224abb52f727bb76`。在该基线的codex-to-phone目录解压，再运行`corepack pnpm install --frozen-lockfile`、`corepack pnpm --filter @mobile-codex/relay build`、`corepack pnpm build:plugin`；完整源码由本仓库保留。构建ID随机，不保证bundle逐字节重现。
- `package.json`：逐文件大小/SHA和来源；`SHA256SUMS`校验全部文件。无用户配置、私钥或凭证。

后端422、手机169及完整verify通过，原指定PNG321,193字节在源码候选读取中一致。归档完成时尚未在线切换或手机确认，实际部署状态以[审计](../../../../../docs/audits/2026-11-07/image-reference-fix.md)为准。按[版本同步](../../../../../docs/ops/version-sync.md)完成单独确认、私有备份、固定目录与正常stop/start；不能覆盖运行目录或改配置/原模型。

本项目MIT；不含Kelivo源码或二进制，整合App的第三方归属沿用上级说明。原code9和DeepSeek0.2.7六份补充保持不变。
