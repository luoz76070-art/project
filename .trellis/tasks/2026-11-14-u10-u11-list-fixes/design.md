# 范围与设计

现有 MessageContent 只识别 HTTP(S) 链接；在真实 inline 渲染入口识别本地目的地，仅生成 span，继续保留代码/原始 HTML 和安全外链规则。
线程路径展示由 model.ts 的 pathTail/shortPath 负责，改显示不改项目身份/持久化键。ProjectGroups 已有项目名，行内不再输出路径。
App 侧栏目前使用隐式无选中条件打开，而遮罩只读 sidebarOpen。统一 sidebarOpen 为唯一来源，初始仍打开空选择的列表，关闭后不会因缺选中线程再次强制打开；保留切分屏关闭行为。
latest-pill 在 composer-panel 中按正常文档流占独立位置，复用 U0 panel/shadow，避免绝对定位覆盖正文。设置折叠共用小型 summary 展示组件，不替换原生 details 的键盘/展开行为。
列表顶部移除检测及设置运行策略的重复检测，复用连接区原测试连接；默认全部隐藏桌面标签、显示非桌面来源；具体筛选隐藏吻合来源，CLI/未知等例外仍可辨识。过滤谓词和 all/desktop/relay 值不变。
不改变请求、消息缓存、发送控制、权限、主题值或其他组件布局。
