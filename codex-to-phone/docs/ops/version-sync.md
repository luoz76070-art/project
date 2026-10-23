# 本地分步提交与版本同步

2026-10-23用户确认采用：开发过程中独立功能/修复完成并通过相关检查后创建本地提交，完整版本验收后集中推送GitHub，并给对应提交打版本标签。手机和电脑发起的任务最终修改同一Mac工作区，使用同一流程；本轮不增加手机Git按钮或后台自动push进程。

## 仓库与范围

当前Git根目录是`/Users/rorance/workspace/project`，项目目录是其下的`codex-to-phone/`，当前main跟踪origin/main，origin指向`github.com/luoz76070-art/project`。继续使用现有仓库，不创建嵌套仓库或切换分支。命令从项目目录执行；父仓库其他工程的工作区修改保留。

提交前暂存区必须为空。有用户已暂存内容时停止自动提交并说明，不通过reset/restore/commit把它清掉或带入。暂存仅使用项目目录内的`git add -- .`；随后从Git根目录核验所有暂存路径均以`codex-to-phone/`开头，检查实际差异后再commit。不能从父仓库执行`git add -A`。

## 开发中的本地检查点

每个检查点只包含一个已完成、相关检查通过的功能或修复；不把未完成代码冒充版本。不为每条聊天/每次保存自动提交。累积的历史修改无法可靠拆分时，可先建立一次有说明的预览基线，之后按独立功能细分。

```sh
cd /Users/rorance/workspace/project/codex-to-phone
git status --short
git diff --cached --name-status
git diff --check -- .
# 确认暂存区为空，检查相关代码及运行适合本次修改的测试后：
git add -- .
git -C /Users/rorance/workspace/project diff --cached --name-only
git diff --cached --stat
git diff --cached
# 确认全部路径属于codex-to-phone且差异正确后：
git commit -m "fix(codex-to-phone): <独立修复说明>"
```

不暂存.env、网关/设备/模型凭证、录音、上传附件、日志、构建缓存、APK/ZIP。沿用`.gitignore`，提交前额外检查新增文件和已有跟踪文件；忽略规则不会让已经跟踪的密钥自动消失。测试中的合成凭证需能与真实配置区分。APK及插件包仍走已有发布/交付目录。

## 完整版本检查

版本应具备：范围完成、相关检查通过、版本号/CHANGELOG/工程入口一致、已有产物身份匹配，以及明确的验收状态。Android真机或供应商等尚有待验时可推送标明preview的源码版本，不称为正式稳定版。当前APK30即预览源码基线。

产品代码改动使用仓库既有检查：`corepack pnpm typecheck`、`corepack pnpm build`、`corepack pnpm build:plugin`、`corepack pnpm test:mobile`、`corepack pnpm test:messages`；按触及模块运行后端回归。需要完整后端时，在Relay及插件构建完成后运行：

```sh
node --test --test-concurrency=2 --test-timeout=15000 apps/relay/tests/*.test.mjs
```

涉及原生/更新时额外运行`corepack pnpm test:apk-update`、`corepack pnpm test:hot-update`和完整Android lint，实际安装另验。纯流程/文档改动检查命令、路径和Git diff即可，不为重复推送机械重跑已验证产品。所有隔离测试不读用户原会话，不提交模型任务或真实审批。

## 集中推送与版本标签

1. `git fetch origin`，确认当前仍为main、上游仍为origin/main。
2. `git rev-list --left-right --count origin/main...HEAD`：远端领先数必须为0；否则先停下分析，不能自动merge/rebase或force。
3. 检查`git log --oneline origin/main..HEAD`及`git log --format= --name-only origin/main..HEAD`，每个未推送提交只含本项目。如果包含其他工程未推送提交，先明确交付范围，不能仅查看最终净差异后推送。
4. 项目工作区应干净，检查目标标签尚不存在。标签格式`codex-to-phone-v<版本>`，预览包含`preview`；使用annotated tag，不移动/覆盖已发布标签。
5. 正常原子推送当前main及该标签。示例仅适用于APK30；未来替换为当次版本：

```sh
git tag -a codex-to-phone-v1.3.9-process-collapse-preview -m "Mobile Codex APK30 preview source"
git push --atomic origin HEAD:refs/heads/main refs/tags/codex-to-phone-v1.3.9-process-collapse-preview
git ls-remote origin refs/heads/main refs/tags/codex-to-phone-v1.3.9-process-collapse-preview 'refs/tags/codex-to-phone-v1.3.9-process-collapse-preview^{}'
```

核对远端main及annotated tag的`^{}`展开值等于预期提交OID；标签本身指向tag对象，不能把tag对象OID直接当commit比较。推送失败/断线先读取远端实际OID，不能假定全部失败后重新造提交/覆盖标签。GitHub代码同步不会自动覆盖安装手机APK、重启网关或发布GitHub Release；这些保持独立交付。

## 长周期备份与完成记录

开发跨日或大量修改尚未提交时，在仓库之外保存`git diff --binary HEAD -- .`和按Git忽略规则筛选的未跟踪源码归档；已提交历史可用`git bundle create <仓库外备份路径> --all`备份。备份权限私有，配置/密钥沿原私有备份流程处理，不塞入源码归档，不把同一块磁盘上的备份当作异机容灾。

每次完整同步记录源码OID、标签、实际远端核验、检查结果和待验项。推送后的少量交付记录可再作一个docs提交，同步后才标记最终标签；不为了反向写入自身OID反复修改文档。Trellis自动提交继续关闭，由本流程明确控制Git操作。
