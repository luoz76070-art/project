# 执行与验证
1. 共享类型和状态机：矩阵/内部终态证据单测。
2. 存储：CAS/幂等/容量/损坏/原子失败/重启/资产边界。
3. REST/SSE：用户验收边界、分页重置、撤销/在途响应和设备共享。
4. Web迁移及现有卡片入口：回读核验、失败恢复、双源冲突、原生能力兼容。
5. 原生ackMigration：摘要CAS、幂等、单份备份、commit失败不丢活动记录；本机先试Gradle，不装SDK。
检查：corepack pnpm typecheck；corepack pnpm build；corepack pnpm lint；node --test --test-concurrency=2 apps/relay/tests/{workItems,deviceRevocation,availability,transport}.test.mjs；corepack pnpm test:mobile；corepack pnpm test:voice；./apps/kelivo/android/gradlew -p apps/kelivo/android :mobile-codex-remote:lintRelease :app:testReleaseUnitTest --tests com.psyche.kelivo.ProductHandoffTest。

## 2026-11-14 验证结果
- 指定 frozen-lockfile / prefer-offline / lane pnpm-store 安装成功；未更改锁文件。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build`：通过（Relay + mobile）。
- `corepack pnpm lint`：通过，零警告。
- `node --test --test-concurrency=2 apps/relay/tests/{workItems,deviceRevocation,availability,transport}.test.mjs`：49/49 通过。
- `corepack pnpm test:mobile`：335/335 通过；包括迁移恢复与原卡片“关闭”/迁移入口渲染。
- `corepack pnpm test:voice`：139/139 通过。
- `./apps/kelivo/android/gradlew -p apps/kelivo/android :mobile-codex-remote:lintRelease :app:testReleaseUnitTest --tests com.psyche.kelivo.ProductHandoffTest`：已尝试，exit 127；当前克隆没有 `apps/kelivo/android/gradlew`，未安装 SDK 或生成 Android 工具链。新增的5项原生迁移用例尚未运行，需 CI 的 Android 检查验证。
- `lgit diff --check`：通过。未运行真机/浏览器验收；本轮 UI 改动采用现有组件渲染测试，原生桥接仍待 Android 验证。

自审：完成只能经过 verify；PATCH/Agent 回写 REST 不可越权；新SSE复用D2所有者/连接配额/撤销清理；磁盘写成功才发布摘要事件；损坏不初始化为空；迁移不调用发送接口、未知结果不当成功；原生ACK与Web清源均按旧身份核对并保留新内容。范围未扩展到W2–W5、历史审计或附件清理。
