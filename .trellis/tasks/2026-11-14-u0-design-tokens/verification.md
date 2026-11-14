# U0 验证与映射记录

基线 `3eec232`；默认 ID 保持 `default`、显示 MobiCodex，旧默认完整保存在新增 `classic`（经典）。其他已保存 ID 和配色未改。仅颜色/令牌替换，组件结构和交互留给 U1–U13。

## 色值表

| ColorScheme 角色 | 浅色 | 深色 |
|---|---|---|
| primary | #1F2228 | #F5F1EA |
| onPrimary | #F5F1EA | #16181D |
| primaryContainer | #E7E3DA | #2A2E37 |
| onPrimaryContainer | #16181D | #F5F1EA |
| secondary | #6B6F78 | #A8A49B |
| onSecondary | #FFFFFF | #16181D |
| secondaryContainer | #ECE8DF | #2A2E37 |
| onSecondaryContainer | #16181D | #F5F1EA |
| tertiary | #B45309 | #F59E0B |
| onTertiary | #FFFFFF | #3D2405 |
| tertiaryContainer | #FDE7C2 | #4A3410 |
| onTertiaryContainer | #3D2405 | #FDE7C2 |
| error | #B42318 | #F97066 |
| onError | #FFFFFF | #2B0A07 |
| errorContainer | #FDE4E1 | #5C1A14 |
| onErrorContainer | #410E09 | #FDE4E1 |
| surface | #F6F4EF | #111317 |
| onSurface | #16181D | #F5F1EA |
| onSurfaceVariant | #5E6066 | #B9B6AE |
| outline | #000000 / 10% | #FFFFFF / 12% |
| outlineVariant | #000000 | #FFFFFF |
| shadow | #000000 | #000000 |
| scrim | #000000 | #000000 |
| inverseSurface | #111317 | #F6F4EF |
| onInverseSurface | #F5F1EA | #16181D |
| inversePrimary | #F5F1EA | #1F2228 |
| surfaceTint | #1F2228 | #F5F1EA |
| primaryFixed | #E7E3DA | #E7E3DA |
| primaryFixedDim | #CBC7BE | #CBC7BE |
| onPrimaryFixed | #16181D | #16181D |
| onPrimaryFixedVariant | #363B46 | #363B46 |
| secondaryFixed | #ECE8DF | #ECE8DF |
| secondaryFixedDim | #D0CCC3 | #D0CCC3 |
| onSecondaryFixed | #16181D | #16181D |
| onSecondaryFixedVariant | #454850 | #454850 |
| tertiaryFixed | #FDE7C2 | #FDE7C2 |
| tertiaryFixedDim | #F6C780 | #F6C780 |
| onTertiaryFixed | #3D2405 | #3D2405 |
| onTertiaryFixedVariant | #6B3906 | #6B3906 |

outline 的 10%/12% 使用最接近的 8 位 alpha 0x1A/0x1F。surfaceContainer* 继续由 theme_factory/SurfaceLadder 统一生成；outlineVariant 保留其原有黑/白基色，hairline 由语义层施加透明度。

## Web 语义色及桥接

| CSS / 宿主字段 | 浅色默认 | 深色默认 |
|---|---|---|
| `--bg-0` / `background` | `#f6f4ef` | `#111317` |
| `--panel / --bg-1` / `panel` | `#fffffe` | `#292b2e` |
| `--bg-2 / --panel-soft` / `fill` | `#ebe9e4` | `#353739` |
| `--text` / `text` | `#16181d` | `#f5f1ea` |
| `--subtle` / `secondaryText` | `#5e6066` | `#b9b6ae` |
| `--accent` / `primary` | `#1f2228` | `#f5f1ea` |
| `--on-accent` / `onPrimary` | `#f5f1ea` | `#16181d` |
| `--accent-soft` / `primaryContainer` | `#e7e3da` | `#2a2e37` |
| `--signal` / `signal` | `#b45309` | `#f59e0b` |
| `--danger` / `error` | `#b42318` | `#f97066` |
| `--user-bubble` / `userBubble` | `#e5e3df` | `#333437` |
| `--avatar-surface` / `avatar` | `#e1dfdb` | `#28292c` |
| `--composer-surface` / `composer` | `#f2f0eb` | `#212326` |
| `--composer-outline` / `composerOutline` | `#c5c3bf` | `#28292c` |
| `--message-author` / `messageAuthor` | `#595a5c` | `#b1aeab` |
| `--border / --hairline` / `outline` | `#dddbd7` | `#2e3033` |
| `--navigation-indicator` / `navigationIndicator` | `#ece8df` | `#2a2e37` |

新增 signal/error 可选映射；secondaryText 改为 onSurfaceVariant，outline 改为 ColorScheme.outline 混合后的六位色。缺失/非法字段移除旧覆盖，回退当前明暗默认；其他配色和动态/自定义设置仍由 Flutter 决定。状态底色 `--status-surface = --panel`，避免浅色琥珀文字叠深填充底。amber 只作为待处理/运行/光标信号，不铺大面积主色。

## 令牌映射（旧值 → 新变量）

### 圆角

| 旧值 | 新变量 |
|---|---|
| `8px`, `6px`, `5px` | `var(--radius-8)` |
| `50%`, `999px` | `var(--radius-pill)` |
| `20px`, `26px`, `22px`, `24px` | `var(--radius-24)` |
| `12px`, `10px` | `var(--radius-12)` |
| `16px`, `14px` | `var(--radius-16)` |

### 间距

| 旧值 | 新变量 |
|---|---|
| `12px`, `10px`, `11px`, `13px` | `var(--space-12)` |
| `8px`, `9px`, `7px`, `6px` | `var(--space-8)` |
| `2px`, `4px`, `3px`, `5px`, `1px` | `var(--space-4)` |
| `18px`, `20px` | `var(--space-20)` |
| `-3px` | `calc(-1 * var(--space-4))` |
| `24px` | `var(--space-24)` |
| `16px`, `14px` | `var(--space-16)` |
| `28px` | `var(--space-28)` |

### 字号

| 旧值 | 新变量 |
|---|---|
| `17px`, `18px`, `16px`, `1rem`, `1.08rem` | `var(--font-size-17)` |
| `12px`, `11px`, `.6875rem`, `.75rem` | `var(--font-size-12)` |
| `15px`, `14px`, `0.9375rem`, `.875rem`, `.9375rem`, `.9rem` | `var(--font-size-15)` |
| `13px`, `.8125rem`, `.8rem`, `.85rem`, `.86rem` | `var(--font-size-13)` |
| `.875em` | `calc(var(--font-size-13) * var(--remote-chat-scale, 1))` |
| `1.25rem` | `var(--font-size-20)` |

字号变量使用 rem（按16px根字号折算12/13/15/17/20），继续乘宿主 remote-chat-scale。等宽字体从 Cascadia/SFMono/Consolas、ui-monospace/SFMono/Menlo 等栈统一为 `--font-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`。零值、边框、控件几何、响应式内容宽度、断点、安全区不强行当间距替换。

## 对比度（sRGB 相对亮度，普通正文 AA ≥ 4.5:1）

| 色对/范围 | 浅色 | 深色 |
|---|---|
| 正文/页面 | 16.16:1 | 16.52:1 |
| 次要正文/页面 | 5.72:1 | 9.18:1 |
| 主按钮 | 14.16:1 | 15.77:1 |
| 琥珀信号/页面 | 4.57:1 | 8.66:1 |
| 琥珀信号/状态底 | 5.02:1 | 6.61:1 |
| 错误/状态底 | 6.57:1 | 5.10:1 |
| 常用五种底色上的正文/次要文字/作者文字最小值 | 4.90:1 | 5.41:1 |

自动检查覆盖34组 Material 前景/背景色对、40组网页正文色对、12组页面/状态底上的信号/错误/成功色对，共86组，均通过4.5阈值。细边框/禁用控件不作为正文AA声明；动态及自定义主题需另验。

## 验证结果

- `corepack pnpm test:mobile`：340/340 通过（含新增令牌及宿主映射回归）。
- `corepack pnpm typecheck`：Relay、mobile 通过。
- `corepack pnpm lint`：通过，零警告。
- 普通版和 `VITE_KELIVO_HOST=android` 网页构建均通过。
- Flutter 静态审计：浅深各40个声明字段（含 brightness），原字段无遗漏、无重复；经典的所有字段与基线旧默认一致；其余配色定义逐字未改。product_shell_test 映射断言已同步。
- 本机没有 Flutter/Dart，未运行 Flutter 编译、分析或测试，仍需真机核对。
- 合成服务已启动；浏览器工具拒绝本地地址访问授权，未进行视觉验收、未保存截图，未绕过权限。

## 合成页打开方式

在仓库根目录执行：

```sh
corepack pnpm --filter @mobile-codex/mobile build --outDir /tmp/u0-standalone-dist
VITE_KELIVO_HOST=android corepack pnpm --filter @mobile-codex/mobile build --outDir /tmp/u0-host-dist
UI_FIXTURE_DIST=/tmp/u0-host-dist UI_FIXTURE_PRODUCT=1 UI_FIXTURE_PORT=4181 node scripts/serve-ui-fixture.mjs
# 另一终端：
UI_FIXTURE_DIST=/tmp/u0-standalone-dist UI_FIXTURE_PORT=4182 node scripts/serve-ui-fixture.mjs
```

- 宿主浅色：`http://127.0.0.1:4181/?productFixture=1&theme=light`
- 宿主深色：`http://127.0.0.1:4181/?productFixture=1&theme=dark`
- 宿主150%字号：以上地址追加 `&chatFontScale=1.5`。
- 普通网页：`http://127.0.0.1:4182/`（通过既有网页设置切换明暗）。

服务只使用合成数据；宿主 fixture 是默认公式投影，未声称真实 Flutter 像素一致。浏览器窄屏/150%字号与真实 Android 外观仍待人工验收。
