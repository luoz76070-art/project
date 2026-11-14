# 实施与验证

1. U1：分组、元信息与长按复制、图标横幅、品牌气泡与间距；跑渲染测试，提交。
2. U2：共享状态栏和停止操作；删除两入口重复运行提示；保留上轮结果规则；增加动效和回归。
3. 运行 corepack pnpm test:mobile、corepack pnpm typecheck、corepack pnpm lint；检查差异与未推送范围；提交 U2，推送并开 PR。
