# 设计

1. 延伸现有messageDiagnostics的白名单报告（v2），采集DOM article身份及可见性，用SHA256关联实际rendered/runtime；保持原缓存只读。核心快照在任何await前捕获。
2. 明确UTF-8上限：摘要2048字节；详细JSON 65536字节，缩减明细时保留统计和省略计数。默认按钮只复制摘要；单独按钮保存详细报告。Android用系统创建文档回调，Web用Blob文件下载；失败、取消和旧APK缺插件分别提示，不能用大JSON回退复制。
3. Vite注入每次构建独立Web ID；Relay普通构建生成dist/build-info.json，插件bundle注入自身build ID。运行时只读自身标识，缺失返回unknown，不把源码版本当运行版本。NativeHotUpdate.getStatus读取真实安装code及活动/待确认版本，已加载热更新读取当前HTML的meta，明确来源。
4. 新鉴权GET /api/diagnostics返回网关build及有界Tunnel事件，不读取Codex。Tunnel状态原因使用枚举、代次递增，拒绝原始错误/URL/close reason；最多20条内存记录。手机SSE每次订阅记有界事件，不持久化正文/身份。摘要裁剪事件而不是无限增长。
5. App采集与复制/导出跨会话或连接切换失效，所有异步读取有截止；网络/原生读不到明确unknown，不阻止已有本地诊断。DOM data属性只做关联，不变更key/消息身份。

涉及chat/messages诊断及components、connection订阅记录、App设置、版本构建脚本、Relay诊断路由/managed Tunnel和Android新文件导出插件。无大规模App拆分，无新三方依赖。测试采用真实生产函数、隔离服务与合成UI夹具，Android编译/lint另记录，系统保存对话框真机待验。

自审：不复用普通状态日志（可能带地址），诊断使用独立白名单；版本未知不猜测；保留旧网关404及旧APK缺插件兼容；不在热更新中假设新增原生能力已存在。
