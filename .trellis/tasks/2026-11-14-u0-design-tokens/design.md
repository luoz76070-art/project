# 设计与范围

修改 palettes.dart、product_shell.dart 及映射测试；网页 styles.css、host.ts、映射/设计令牌测试和合成宿主 fixture。默认移动端既有 SurfaceLadder 继续决定卡片/填充，CSS 使用对应值；纯底/分层/动态/自定义配置仍由 Flutter 下发。

signal 来自 tertiary，error 来自 error；缺字段/非法颜色清除内联覆盖并回退浅深默认。outline 使用 ColorScheme.outline，secondaryText 使用 onSurfaceVariant，避免默认半透明文字对比度不足。固定色角色按 M3 成对补齐；surfaceContainer 阶梯保持现有生成所有者。

CSS 仅替换 token 声明和值，不改组件结构和交互；零圆角/间距保留，圆形归胶囊；几何尺寸、边框宽、断点、安全区和文本缩放不当作间距重写。字体以 rem 定义，继续支持系统字号和 remote-chat-scale。
