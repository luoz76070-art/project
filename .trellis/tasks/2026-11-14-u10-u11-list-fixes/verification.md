# U10/U11 验证

## 变更与结果

- 本地 Markdown 链接：绝对/相对、Windows、file:、空格括号和行号均显示文件名 span，完整路径进入 title，不生成本地 href 或下载请求；HTTP(S)外链、图片、代码、原始HTML文本行为保留。
- pathTail/shortPath 输出正斜杠；原始路径与项目分组身份不重写。
- 抽屉侧栏与遮罩统一使用 sidebarOpen；无选中项时初始打开，关闭不再被隐式条件强制重开。保持分屏切换关闭行为，遮罩为可键盘激活的关闭按钮，浅深色复用 --scrim。
- 最新消息按钮在 composer-panel 内正常流占位，沿用 --panel-strong/--shadow，宿主不再覆盖掉阴影；未实测窄屏触摸命中。
- 设置四处 details（语音、连接能力、诊断、更新）使用共享 DisclosureSummary + Lucide ChevronRight；原生 marker 隐藏，打开旋转90度，保留原生 details 行为。
- ThreadRow 保留标题/时间/选中/点击以及唯一“当前桌面”标记，移除每条路径。全部隐藏常规桌面来源、保留手机/CLI/Exec/未知；desktop隐藏桌面、relay隐藏appServer，例外来源保留。窄分屏也不额外隐藏这些例外标签。
- 顶部只留新线程/桌面；检测收敛到设置 → 手动连接 → 测试连接，复用原handler及检测中禁用逻辑。
- 筛选显示全部/电脑发起/手机发起，all/desktop/relay及过滤谓词不变。relay原语义包含非Desktop的CLI/Exec/未知来源，仍用准确的小标签区分，不误称手机。
- 查看更早/只看近30天变为文字链接外观的button，保留44px命中区、禁用及range切换语义。

## 检查

- 指定 pnpm frozen install 成功，296个包全部缓存复用，无新增依赖。
- U10 定向渲染/连接：131/131；类型检查和lint通过。
- 完整检查首次发现 VoiceSettings 测试夹具缺 DisclosureSummary 注入；已同步夹具并归入U10提交。
- 最终 `corepack pnpm test:mobile`：348/348 通过（新增8项）。
- 最终 `corepack pnpm typecheck`：Relay、mobile通过。
- 最终 `corepack pnpm lint`：通过，零警告。
- 普通网页构建通过；最终宿主构建 `VITE_KELIVO_HOST=android corepack pnpm --filter @mobile-codex/mobile build --outDir /tmp/u10-u11-host-dist` 通过。
- `lgit diff --check`通过；U0 :root浅深变量逐字一致，无新增颜色字面量。

## 人工验收边界

按用户要求未打开浏览器；CSS结构断言与组件SSR/回调测试不能代替视觉和真实Android触摸验收。最新消息在窄屏、多行输入、待发项时的空间占用，以及浅深遮罩/折叠箭头由Claude通过合成页检查。

合成页可运行：

```sh
VITE_KELIVO_HOST=android corepack pnpm --filter @mobile-codex/mobile build --outDir /tmp/u10-u11-host-dist
UI_FIXTURE_DIST=/tmp/u10-u11-host-dist UI_FIXTURE_PRODUCT=1 UI_FIXTURE_PORT=4183 node scripts/serve-ui-fixture.mjs
```

打开 `http://127.0.0.1:4183/?productFixture=1&theme=light` 或 `theme=dark`，150%字号可追加 `&chatFontScale=1.5`。未启动新服务、未读取真实会话或调用真实模型。
