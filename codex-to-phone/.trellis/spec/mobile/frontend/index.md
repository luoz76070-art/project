# Mobile 前端规范

## Pre-Development Checklist

先读 [目录与状态边界](architecture.md) 和 [验证与 UI 约束](quality-guidelines.md)，再读当前 task 文档。更新功能还须读 [APK更新契约](apk-update-contract.md)。视觉细则见 `docs/ui-interaction-spec.md`。

## Quality Check

类型检查、生产构建和消息回归后，涉及渲染/连接行为时补浏览器与真机可行的验收。明确未验证的原生能力。

手动诊断、版本定位和报告导出须遵循[短诊断契约](diagnostics-contract.md)，尤其是UTF-8大小上限、身份白名单与原生/浏览器验收边界。
