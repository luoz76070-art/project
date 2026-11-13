# 设计与自审

缺口在 VoiceInput.finished：录音仅为局部变量，失败即失去重用入口。将有效音频保存为 session 的可清除内存引用，提取同一个 transcribe 函数供初次和重转使用；finished 标志在首次 await 前加锁。每次仍由 submit 生成 UUID、保存最少恢复元数据并 POST 一次。失败进入 failed 阶段，成功在 refine 前释放音频。

recovery 将服务端 cancelled 映射 AbortError，failed/not_found/本地 TTL 到期仍为普通失败。VoiceInput 对取消释放、其他失败保留；作用域/线程变化及卸载明确清除音频，已上传请求仍按 V1 detach。

范围：VoiceInput、recovery、生产组件测试夹具/语音测试、语音契约与任务文档。Relay 生产代码、持久化 schema、原生录音、整理算法及 CSS 不变。测试直接运行生产组件的事件/effect逻辑与恢复协调器，Relay 路由测试核验失败缓存和新 ID 调用次数。合成 hooks 不代替真实 React DOM/Android。
