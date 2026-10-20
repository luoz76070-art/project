# Relay 后端规范

## Pre-Development Checklist

先读 [模块结构](directory-structure.md)、[运行与错误边界](runtime.md)、[传输契约](transport-contract.md) 和 [验证](quality-guidelines.md)，再读当前 task 的 PRD/design/implement。

## Quality Check

按验证文档完成类型检查、构建和隔离传输测试；核对未触发真实 Desktop 控制。模块迁移保持入口兼容。
