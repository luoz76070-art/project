# APK32预览源码同步

2026-10-23，用户明确要求将当前改动推送GitHub。复用[版本同步流程](../../ops/version-sync.md)，沿用父仓库`luoz76070-art/project`的`main`，同步范围仅为`codex-to-phone/`。

## 源码与标签

- 源码提交：`00611079228f2fba1e22c17dd20aa39b51715e0f`，包含APK31输入关联/缓存修复、APK32紧凑输入区及相关测试、规范和交付记录，共24文件。
- 本次将已累积且共享版本文件的改动整理为一个源码提交，未重建或伪造APK31的历史提交。
- 交付记录随后作为独立docs提交，与源码一起原子推送；最终预览标签为`codex-to-phone-v1.3.11-compact-composer-preview`，指向包含交付记录的提交。
- 最终远端main及annotated tag展开OID，以`git ls-remote`实际核验为准；结果保存于`output/audit/2026-10-23/apk32-github-sync/remote-verification.json`，避免反复修改文档写入自身OID。

## 本轮检查

重新通过手机69/69、消息回归、两端typecheck、Relay/Mobile生产构建、fixture语法及Git差异检查。提交前暂存区为空，24个候选文件完成常见密钥格式检查；暂存内容逐文件SHA256与已审查工作区一致，全部属于本项目。

原APK32发布轮的浏览器19项、完整Android lint及公网19项结果沿用[原交付记录](compact-running-composer.md)，本轮没有重新发布APK、热更新或切换网关。实际构建与检查日志仍走忽略目录，不随源码上传。

## 待验与边界

APK32仍为preview；真机安装、触摸/键盘及原重复截图保持待验，两个task继续为in_progress。父仓库其他工程的修改和未跟踪文件保留，不纳入提交。未创建新分支、PR或GitHub Release，未提交真实模型任务或处理用户队列。
