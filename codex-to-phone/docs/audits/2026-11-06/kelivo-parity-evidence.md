# Kelivo 固定版本：59组证据账本

日期：2026-11-06。范围和逐项验收条件继续以[原矩阵](../../plans/2026-11-03-kelivo-parity-matrix.md)为准。本账本分别记录源码、隔离、设备、外部服务；**整组完成0/59**。同一行列出的测试只证明该文件内的部分分支，不代表整组已通过。

- S1：固定v1.3.4/4a7da9b6的5052来源文件，当前复核无缺失；最终精确差异见`output/audit/2026-11-06/kelivo-device/source-changes-layout.json`（28来源修改/16非忽略新增）；旧交接轮清单保留。G组沿用原React/Relay实现。源码保留不等于功能验收。
- H1：2026-11-05 Flutter全量历史记录，11,437通过、3跳过、0失败。下表仅链接确实出现在该轮日志中的相关测试文件，未将其计作2026-11-06全量复跑。日志`output/audit/2026-11-05/kelivo-product/flutter-full-final.log`；跳过项仍不计通过。
- I1：2026-11-06远控完整verify：手机152、后端403，检查入口8；日志`output/audit/2026-11-06/kelivo-handoff/verify-theme-final.log`。首次退出超时失败仍保留，不能写为已修复。
- I2：本轮Flutter产品/更多菜单17项、完整Dart分析；最终原生全量333项（含Android24/36隔离用例），完整lint0错误、56/1警告。日志同目录`native-preview-delivery.log`。
- V1：本轮浏览器合成数据，交接确认/附件、ACK重开锁、取消/保存失败、12组窄屏布局；见[本轮审计](kelivo-handoff.md)。不能替代Android真实权限、模型或电脑任务。
- N1：Android36独立模拟器已安装最终code3（SHA前缀`ec663ce1`），6项原生离线导航/独立草稿/设置返回/页面重建/主题及原生事件通过；`instrumentation-delivery.log`、`native-delivery-evidence/result.json`。只计局部设备证据，不用它替代整组、真机或系统回收。

- I3：设备接续轮本地证据，原生338项、Flutter产品/菜单18项、备份/业务库/加密/快照/URI定向184项及完整Dart分析通过，完整lint0错误、56/1警告；见[设备审计](kelivo-device.md)及`output/audit/2026-11-06/kelivo-device/`。备份相关是隔离测试，不等同新包系统导出/导入。收尾完整远控verify手机152/后端403、入口8及其余步骤通过（`kelivo-device/verify-final.log`）；首次文件通知超时保留，根因未定。

- N2：最终code4（SHA前缀`e3fa92e2`）Android36独立模拟器13项通过，含前台系统浅深、显式主题、原生系统栏像素、150%字体/IME、横竖屏与首尾滚动、返回/前后台及双草稿；同版本开发覆盖后显式进程重启恢复也通过。见[设备审计](kelivo-device.md)、`kelivo-device/native-layout-final/result.json`和`native-recovery-layout/result.json`。真机、正式升级、真实系统回收及完整系统插件仍待验。

表内“待验”是未取得符合原矩阵验收条件的证据；纯本地功能的外部服务列写“不涉及”。Android24实机、手机系统插件、登录账号及真实模型/电脑接收均未验。iOS/macOS/Linux/Windows沿原矩阵的平台范围单独验收，本次APK不能证明这些平台完整可用。

| ID | 功能组 | 源码 | 隔离证据（仅列部分） | 设备 | 外部服务 |
| --- | --- | --- | --- | --- | --- |
| A01 | OpenAI Chat Completions/Responses、Gemini/Vertex、Claude 与自定义 OpenAI 兼容地址 | 保留 S1 | H1（部分）：[chat_api_generate_message_test.dart](../../../apps/kelivo/test/chat_api_generate_message_test.dart)、[gemini_malformed_response_retry_test.dart](../../../apps/kelivo/test/gemini_malformed_response_retry_test.dart) | 待验 | 待验 |
| A02 | ChatGPT/Codex、Grok、Kimi Code、Claude 账号登录，模型同步与额度/状态显示 | 保留 S1 | H1（部分）：[model_provider_oauth_test.dart](../../../apps/kelivo/test/core/providers/model_provider_oauth_test.dart)、[chatgpt_oauth_parity_test.dart](../../../apps/kelivo/test/core/services/auth/chatgpt_oauth_parity_test.dart) | 待验 | 待验 |
| A03 | 模型能力覆盖：文字/图片/视频标识、工具、推理预算、搜索/代码执行/生图等供应商原生选项 | 保留 S1 | H1（部分）：[ocr_model_capability_test.dart](../../../apps/kelivo/test/features/model/ocr_model_capability_test.dart)、[settings_provider_reasoning_support_test.dart](../../../apps/kelivo/test/settings_provider_reasoning_support_test.dart) | 待验 | 待验 |
| A04 | 供应商自定义请求头/请求体，模型参数与上下文配置 | 保留 S1 | H1（部分）：[chat_api_extra_headers_test.dart](../../../apps/kelivo/test/chat_api_extra_headers_test.dart) | 待验 | 待验 |
| A05 | 多 Key：轮询、优先级、最少使用、随机，异常 Key 标记/切换 | 保留 S1 | 未定位专用记录；不推定通过 | 待验 | 待验 |
| A06 | HTTP/HTTPS/SOCKS5 代理、按供应商配置、缓存及指数退避重试 | 保留 S1 | H1（部分）：[auto_retry_options_test.dart](../../../apps/kelivo/test/core/models/auto_retry_options_test.dart)、[chat_api_auto_retry_test.dart](../../../apps/kelivo/test/core/services/api/chat_api_auto_retry_test.dart) | 待验 | 待验 |
| A07 | 余额查询、供应商排序/分组/启停、配置文本/二维码分享导入 | 保留 S1 | H1（部分）：[provider_balance_service_test.dart](../../../apps/kelivo/test/provider_balance_service_test.dart)、[provider_grouping_logic_test.dart](../../../apps/kelivo/test/provider_grouping_logic_test.dart) | 待验 | 待验 |
| A08 | 供应商预置模板与特殊内置服务，包括源码中的 KelivoIN 等配置 | 保留 S1 | 未定位专用记录；不推定通过 | 待验 | 待验 |
| B01 | 助手独立模型、系统提示词模板、预设消息、采样、上下文长度 | 保留 S1 | H1（部分）：[assistant_provider_prompt_readiness_test.dart](../../../apps/kelivo/test/core/providers/assistant_provider_prompt_readiness_test.dart)、[assistant_settings_edit_prompt_tab_time_test.dart](../../../apps/kelivo/test/features/assistant/pages/assistant_settings_edit_prompt_tab_time_test.dart) | 待验 | 待验 |
| B02 | 头像/背景、标签、快捷短语、消息正则、独立工具/MCP/技能/工作区配置 | 保留 S1 | H1（部分）：[settings_provider_assistant_avatar_ux_test.dart](../../../apps/kelivo/test/settings_provider_assistant_avatar_ux_test.dart) | 待验 | 待验 |
| B03 | 创建/重命名/删除/置顶、标签组织、全局搜索、助手间移动会话 | 保留 S1 | H1（部分）：[side_drawer_conversation_list_test.dart](../../../apps/kelivo/test/features/home/widgets/side_drawer_conversation_list_test.dart) | 待验 | 不涉及 |
| B04 | 流式输出、停止、重新生成、编辑、多个回复版本 | 保留 S1 | H1（部分）：[chat_actions_regeneration_context_test.dart](../../../apps/kelivo/test/features/home/controllers/chat_actions_regeneration_context_test.dart)、[stream_controller_restore_test.dart](../../../apps/kelivo/test/features/home/controllers/stream_controller_restore_test.dart) | 待验 | 待验 |
| B05 | 会话分支、临时聊天、上下文压缩及压缩后开启新会话 | 保留 S1 | H1（部分）：[context_compression_service_test.dart](../../../apps/kelivo/test/core/services/chat/context_compression_service_test.dart) | 待验 | 待验 |
| B06 | 会话级模型/系统提示词覆盖、建议问题、工具描述自定义 | 保留 S1 | H1（部分）：[tool_schema_overrides_test.dart](../../../apps/kelivo/test/core/services/tools/tool_schema_overrides_test.dart) | 待验 | 待验 |
| B07 | 长期记忆：自动抽取/去重/合并、四类记忆、全局/助手作用域 | 保留 S1 | H1（部分）：[memory_assistant_isolation_test.dart](../../../apps/kelivo/test/core/services/memory/memory_assistant_isolation_test.dart)、[memory_pipeline_test.dart](../../../apps/kelivo/test/core/services/memory/memory_pipeline_test.dart) | 待验 | 待验 |
| B08 | 用户画像、记忆搜索/编辑/归档及整理过程查看 | 保留 S1 | H1（部分）：[memory_repository_test.dart](../../../apps/kelivo/test/core/services/memory/memory_repository_test.dart)、[memory_ui_pages_test.dart](../../../apps/kelivo/test/features/settings/pages/memory_ui_pages_test.dart) | 待验 | 待验 |
| B09 | 世界书关键词/正则触发、扫描/激活及注入配置 | 保留 S1 | H1（部分）：[world_book_context_usage_test.dart](../../../apps/kelivo/test/features/home/services/world_book_context_usage_test.dart) | 待验 | 不涉及 |
| B10 | 指令卡片及分组、选择和注入 | 保留 S1 | H1（部分）：[instruction_injection_store_test.dart](../../../apps/kelivo/test/core/services/instruction_injection_store_test.dart) | 待验 | 不涉及 |
| B11 | 本地消息、附件、完整上下文与工具过程；长对话 minimap | 保留 S1 | H1（部分）：[chat_database_gateway_test.dart](../../../apps/kelivo/test/core/database/chat_database_gateway_test.dart)、[chat_database_observability_test.dart](../../../apps/kelivo/test/core/database/chat_database_observability_test.dart) | 待验 | 待验 |
| C01 | shell/read_file/view_image/write_file/edit_file/list_dir/glob/grep 八种工作区工具 | 保留 S1 | H1（部分）：[host_file_tools_test.dart](../../../apps/kelivo/test/core/services/workspace/host_file_tools_test.dart)、[workspace_tools_service_test.dart](../../../apps/kelivo/test/core/services/workspace/workspace_tools_service_test.dart) | 待验 | 待验 |
| C02 | 工具审批、文件 diff、命令流输出、会话完全访问模式 | 保留 S1 | H1（部分）：[workspace_permissions_test.dart](../../../apps/kelivo/test/core/services/workspace/workspace_permissions_test.dart)、[unified_diff_view_test.dart](../../../apps/kelivo/test/features/chat/widgets/unified_diff_view_test.dart) | 待验 | 待验 |
| C03 | Android PRoot Ubuntu/Debian/Alpine，自定义 rootfs | 保留 S1 | H1（部分）：[workspace_integrity_test.dart](../../../apps/kelivo/test/core/services/workspace/workspace_integrity_test.dart)、[workspace_runtime_bootstrap_test.dart](../../../apps/kelivo/test/core/services/workspace/workspace_runtime_bootstrap_test.dart) | 待验 | 待验 |
| C04 | 应用内 PTY 终端、多会话、文件浏览/编辑/预览、手机外部挂载目录（最多 10 个） | 保留 S1 | H1（部分）：[external_mount_paths_test.dart](../../../apps/kelivo/test/core/services/workspace/external_mount_paths_test.dart)、[workspace_session_sync_test.dart](../../../apps/kelivo/test/core/services/workspace/workspace_session_sync_test.dart) | 待验 | 不涉及 |
| C05 | 共享环境变量及输出中的敏感值遮蔽 | 保留 S1 | H1（部分）：[environment_output_redactor_test.dart](../../../apps/kelivo/test/core/services/workspace/environment_output_redactor_test.dart) | 待验 | 不涉及 |
| C06 | SKILL.md：文本、md/zip、GitHub 导入，助手/会话选择及注入 | 保留 S1 | H1（部分）：[skills_prompt_test.dart](../../../apps/kelivo/test/core/services/skills/skills_prompt_test.dart)、[skills_service_test.dart](../../../apps/kelivo/test/core/services/skills/skills_service_test.dart) | 待验 | 待验 |
| C07 | MCP Streamable HTTP/SSE/STDIO、OAuth、JSON 导入、逐工具启用与审批、内置 fetch | 保留 S1 | H1（部分）：[mcp_oauth_authorization_test.dart](../../../apps/kelivo/test/core/services/mcp/mcp_oauth_authorization_test.dart)、[workspace_stdio_transport_test.dart](../../../apps/kelivo/test/core/services/mcp/workspace_stdio_transport_test.dart) | 待验 | 待验 |
| C08 | 模型向用户提问、接收答案并继续工具轮次 | 保留 S1 | H1（部分）：[ask_user_interaction_service_test.dart](../../../apps/kelivo/test/ask_user_interaction_service_test.dart) | 待验 | 待验 |
| C09 | 时间、剪贴板、计算器、TTS 等本地工具 | 保留 S1 | 未定位专用记录；不推定通过 | 待验 | 不涉及 |
| C10 | Android 日历、定位、应用使用时长等设备工具 | 保留 S1 | 未定位专用记录；不推定通过 | 待验 | 不涉及 |
| C11 | 定时任务：任务设置、执行、通知和启动恢复；iOS 另有准备式实现 | 保留 S1 | H1（部分）：[scheduled_tasks_service_test.dart](../../../apps/kelivo/test/core/services/scheduled_tasks_service_test.dart)、[scheduled_task_runner_test.dart](../../../apps/kelivo/test/features/scheduled_tasks/scheduled_task_runner_test.dart) | 待验 | 待验 |
| C12 | 内置浏览器页面/多标签、书签与管理；模型导航、DOM/快照、截图、点击/输入/选择/滚动/等待/页面 JS | 保留 S1 | H1（部分）：[browser_tools_service_test.dart](../../../apps/kelivo/test/core/services/browser/browser_tools_service_test.dart)、[browser_bookmark_editor_test.dart](../../../apps/kelivo/test/features/browser/browser_bookmark_editor_test.dart) | 待验 | 待验 |
| C13 | Android 无障碍 phone_control：读取节点、点击/长按、替换文本、滚动/滑动、启动 App、系统导航 | 保留 S1 | H1（部分）：[phone_control_test.dart](../../../apps/kelivo/test/features/home/services/phone_control_test.dart) | 待验 | 不涉及 |
| D01 | 联网搜索、服务切换、结果引用、多 Key 轮换及服务特有参数 | 保留 S1 | 未定位专用记录；不推定通过 | 待验 | 待验 |
| D02 | 系统 TTS 和全部网络 TTS，分段播放、暂停/继续/重播及供应商音色/格式参数 | 保留 S1 | H1（部分）：[network_tts_test.dart](../../../apps/kelivo/test/core/services/tts/network_tts_test.dart)、[tts_services_page_test.dart](../../../apps/kelivo/test/features/settings/pages/tts_services_page_test.dart) | 待验 | 待验 |
| D03 | 系统 ASR、本地 Sherpa-ONNX、全部云 ASR，输入框转写 | 保留 S1 | H1（部分）：[asr_service_options_test.dart](../../../apps/kelivo/test/core/services/asr/asr_service_options_test.dart)、[cloud_asr_service_test.dart](../../../apps/kelivo/test/core/services/asr/cloud_asr_service_test.dart) | 待验 | 待验 |
| D04 | 图片/PDF/Word/文本代码/支持模型的音频输入，OCR、图片压缩 | 保留 S1 | H1（部分）：[native_input_attachments_test.dart](../../../apps/kelivo/test/native_input_attachments_test.dart)、[image_compressor_test.dart](../../../apps/kelivo/test/utils/image_compressor_test.dart) | 待验 | 待验 |
| D05 | 模型生图、图片展示/保存及原生生图参数 | 保留 S1 | 未定位专用记录；不推定通过 | 待验 | 待验 |
| D06 | 翻译页面与消息翻译 | 保留 S1 | 未定位专用记录；不推定通过 | 待验 | 待验 |
| D07 | Markdown、高亮、LaTeX、表格、Mermaid、HTML 预览与图示 PNG 导出 | 保留 S1 | H1（部分）：[markdown_static_blocks_test.dart](../../../apps/kelivo/test/shared/widgets/markdown_static_blocks_test.dart) | 待验 | 不涉及 |
| D08 | 原生 GenUI：kelivo-ui 声明式组件、表格/图表/表单、交互事件、状态、搜索及导出 | 保留 S1 | H1（部分）：[export_snapshot_test.dart](../../../apps/kelivo/test/features/intelligent_ui/export_snapshot_test.dart)、[search_navigation_test.dart](../../../apps/kelivo/test/features/intelligent_ui/search_navigation_test.dart) | 待验 | 不涉及 |
| D09 | Web GenUI：kelivo-web 交互式 HTML、预览、状态与导出 | 保留 S1 | H1（部分）：[web_controller_test.dart](../../../apps/kelivo/test/features/intelligent_ui/web_controller_test.dart)、[web_widgets_test.dart](../../../apps/kelivo/test/features/intelligent_ui/web_widgets_test.dart) | 待验 | 不涉及 |
| E01 | SQLite/Drift 本地库、消息/附件/配置及迁移/启动恢复 | 保留 S1 | H1（部分）：[private_data_storage_test.dart](../../../apps/kelivo/test/core/database/private_data_storage_test.dart)、[storage_recovery_regression_test.dart](../../../apps/kelivo/test/core/database/storage_recovery_regression_test.dart)；I3定向部分 | 待验 | 不涉及 |
| E02 | Markdown/文本/图片导出、复制与分享 | 保留 S1 | H1（部分）：[message_export_sheet_test.dart](../../../apps/kelivo/test/features/chat/widgets/message_export_sheet_test.dart) | 待验 | 不涉及 |
| E03 | WebDAV、S3、本地备份；覆盖/合并恢复；上游已有加密配置 | 保留 S1 | H1（部分）：[backup_encryption_test.dart](../../../apps/kelivo/test/core/services/backup/backup_encryption_test.dart)、[local_snapshot_service_test.dart](../../../apps/kelivo/test/core/services/backup/local_snapshot_service_test.dart)；I3定向部分 | 待验 | 待验 |
| E04 | 自动快照、周/月保留、手动恢复及恢复前副本 | 保留 S1 | H1（部分）：[chat_database_repository_snapshot_test.dart](../../../apps/kelivo/test/core/database/chat_database_repository_snapshot_test.dart)、[message_part_snapshot_test.dart](../../../apps/kelivo/test/core/models/message_part_snapshot_test.dart)；I3定向部分 | 待验 | 不涉及 |
| E05 | Kelivo 备份兼容，Cherry Studio/Chatbox 导入 | 保留 S1 | H1（部分）：[chatbox_importer_business_test.dart](../../../apps/kelivo/test/core/services/backup/chatbox_importer_business_test.dart)、[cherry_importer_isolate_parse_test.dart](../../../apps/kelivo/test/core/services/backup/cherry_importer_isolate_parse_test.dart) | 待验 | 不涉及 |
| E06 | 请求日志、完整上下文日志、日志保留及存储占用管理 | 保留 S1 | H1（部分）：[storage_usage_service_test.dart](../../../apps/kelivo/test/core/services/storage/storage_usage_service_test.dart)、[storage_usage_service_workspace_test.dart](../../../apps/kelivo/test/core/services/storage/storage_usage_service_workspace_test.dart) | 待验 | 不涉及 |
| E07 | 热力图、消息/token/缓存、模型/助手统计 | 保留 S1 | H1（部分）：[storage_usage_service_test.dart](../../../apps/kelivo/test/core/services/storage/storage_usage_service_test.dart)、[storage_usage_service_workspace_test.dart](../../../apps/kelivo/test/core/services/storage/storage_usage_service_workspace_test.dart) | 待验 | 不涉及 |
| E08 | 主题明暗/动态取色、壁纸/渐变、气泡、主题导入分享 | 保留 S1 | H1（部分）：[chat_bubble_style_overrides_test.dart](../../../apps/kelivo/test/features/chat/widgets/chat_bubble_style_overrides_test.dart)、[settings_provider_chat_bubble_style_test.dart](../../../apps/kelivo/test/settings_provider_chat_bubble_style_test.dart) | N2部分：浅深/跟随系统、电脑前台切换与系统栏；动态取色/壁纸/导入等待验 | 不涉及 |
| E09 | 本地导入/下载字体，简中/繁中/英文 | 保留 S1 | H1（部分）：[settings_provider_local_font_test.dart](../../../apps/kelivo/test/settings_provider_local_font_test.dart) | N2部分：Android150%系统字体；本地/下载字体及语言切换待验 | 不涉及 |
| E10 | 后台生成、完成通知、Android 实时进度通知及悬浮窗 | 保留 S1 | H1（部分）：[mobile_background_settings_loading_test.dart](../../../apps/kelivo/test/core/services/mobile_background_settings_loading_test.dart)、[mobile_background_test.dart](../../../apps/kelivo/test/core/services/mobile_background_test.dart) | 待验 | 待验 |
| E11 | Android 系统分享、文本选择处理、文件入口及登录深链 | 保留 S1 | H1（部分）：[mcp_oauth_callback_android_test.dart](../../../apps/kelivo/test/core/services/mcp/mcp_oauth_callback_android_test.dart) | 待验 | 不涉及 |
| E12 | 同 APK 升级、上游依赖版本与诊断、应用设置/关于页的既有可达入口 | 保留 S1 | H1（部分）：[product_shell_test.dart](../../../apps/kelivo/test/product/product_shell_test.dart)；I2：独立包/预览更新隔离 | N2部分：独立安装/入口/设置返回及同版本开发覆盖；正式升级/诊断等待验 | 不涉及 |
| G01 | 连接档案、鉴权、Broker/Tunnel 及网络恢复 | 原实现保留；I1回归 | I1：[回归文件](../../../scripts/test-mobile-connection.mjs) | 待验 | 待验 |
| G02 | 消息身份、发送确认、审批/提问、排队/引导/停止 | 原实现保留；I1回归 | I1：[回归文件](../../../scripts/test-mobile-handoff.mjs) | 待验 | 待验 |
| G03 | 草稿、历史缓存、附件、项目及会话组织 | 原实现保留；I1回归 | I1：[回归文件](../../../scripts/test-mobile-product.mjs) | N2部分：Codex/AI离线独立草稿、WebView重建/进程重启/旋转/前后台；附件/阅读位置等待验 | 不涉及 |
| G04 | 录音与语音整理、剪贴板、文件保存、诊断 | 原实现保留；I1回归 | I1：[回归文件](../../../scripts/test-mobile-voice.mjs) | 待验 | 待验 |
| G05 | APK 更新、Web 热更新、原生安全凭证 | 原实现保留；整合独立 APK 源接通，热更新暂未接通 | I1：APK 6项/原生下载39断言、更新页五场景及错误/继续回归；[更新审计](kelivo-update.md) | Android36 code4→6覆盖、更新入口/硬件返回通过；系统授权/下载覆盖安装与真机待验 | 独立静态源公网验收单列 |
| G06 | 原 Agent 宿主控制和协议位置 | 原实现保留；I1回归 | I1：[回归文件](../../../apps/relay/tests/deepSeek.test.mjs) | 待验 | 待验 |

## 下一步验收输入与结果格式

按原矩阵“必须取得的验收证据”逐项执行，登记设备/系统、APK SHA、可复现操作、截图/日志、预期与实际。每组内部的协议/服务/平台不能合并抽样替代：A01全部协议、A02四类账号、D01全部搜索服务、D02全部TTS、D03全部ASR分别建子项。无账号、权限或运行环境时保留待验，不使用其他服务的成功结果抵算。

优先次序：同包升级/身份与入口 → 备份往返和Intent/系统回收 → Android24兼容/权限 → 工作区PRoot/PTY/MCP → 服务与模型。真实模型和电脑任务采用用户明确指定的测试目标及授权；本轮没有自动提交。
