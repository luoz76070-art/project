# 首轮视觉迁移设计

## 可行性结论与实施边界

现有远控的消息/会话/连接状态已有 features 分层，主样式在 apps/mobile/src/styles.css，消息展示集中在 features/chat/components.tsx；因此可以在 React 中实现 Kelivo 的视觉语言，同时保留原通信、状态和 Capacitor 插件。这个范围可立即实施并隔离验证。

AI 与远控各自独立入口在产品结构上可实现，且不要求两个模型持续互相转述。完整 Kelivo Flutter 运行时与原远控组合仍有 Application、主题、生命周期、插件及更新兼容风险；本次仅迁移视觉不证明原生组合可构建，也不替代完整功能矩阵验收。

## 已核对的真实参考

- 固定版本：Kelivo v1.3.4，提交 4a7da9b6f5d77caccb9f8aaf656232a93ab14708。
- docx/screenshot_1.png、screenshot_2.png、screenshot_4.png 展示无围框聊天画布、角色头像/时间、右侧圆角用户气泡、淡靛蓝工具区和两行圆角输入框；这些是固定 tag 自带宣传截图，不冒称当前 Android 真机截图。
- lib/theme/palettes.dart 默认主题：浅色 surface #f7f7f7、text #202020、primary #4d5c92；深色 surface #121213、text #f9f9f9、primary #b6c4ff。
- lib/theme/surface_ladder.dart 定义弱描边与中性容器；lib/theme/chat_bubble_style.dart 默认圆角 16；lib/features/home/widgets/chat_input_bar.dart 与 features/settings/pages/settings_page.dart 提供输入和分组设置的结构参考。
- 本轮采用固定默认主题，不实现 Kelivo 全部自定义主题设置；完整功能整合范围继续保留。

## 改动所在位置

- apps/mobile/src/styles.css：更换全局浅深主题和现有参考样式区，统一画布、侧栏、输入、设置、工具/确认及 Agent 样式；沿用断点与布局约束，不层叠一份新的主题文件。
- apps/mobile/src/features/chat/components.tsx：恢复 Kelivo 式角色身份与时间行，使用已有 assistantLabel，复用现有消息/附件/复制逻辑。
- apps/mobile/src/app/App.tsx：顶栏线程入口改为菜单图标，保持原 aria-label/事件与控制条件。
- 文档、任务和必要的视觉约束 spec：更新候选状态、证据与验证结果。

不改会话合并、订阅、发送、运行策略、数据缓存或后台业务。视觉统一不要求两套业务数据库合并，也不添加尚未实现的 AI 入口。

## 自审

- 避免将 UI 迁移等同于完整 Kelivo 集成；明确两个不同验收层级。
- 优先替换现有全局样式与参考段，不引入组件库、字体下载、持续模糊或额外模型调用。
- 同时覆盖 Agent、设置与深层控制卡片，避免只改首页色值。
- 触控目标维持 44px；主要/危险/禁用状态使用真实能力，不借样式启用按钮。
- 只用隔离夹具验证界面与请求，Android 键盘、安全区和系统操作另列待验。
