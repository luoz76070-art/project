# 核对与设计
现有三类 SSE（desktop threads 含 delta、live turns、agent sessions）都按 owner 登记，设备鉴权与流票据会核验 devices.has；subscribeEvents 自己的 401 已停止重试。
缺口：撤销先等待持久化、队列和语音清理；在途 HTTP 未复核；Agent watchSession 等待上游期间尚未发送响应；手机 REST 401 未联动其他订阅、列表/健康/语音轮询。
改动边界：DeviceRegistry 即时封禁且失败保持封禁；revoke 同步关闭流并清票据，再等异步清理；全局 preHandler/onSend 复核 owner，迟到 JSON/错误/二进制结果均替换 401。初始化中的 Agent SSE 关闭时主动完成 401，迟到 unsubscribe 释放。
手机 HTTP 层以 endpoint（含 Broker 路径）+ token 建立内存失效门，401 通知同凭证全部订阅/轮询；原生迟到结果也不能回写。新凭证独立，不持久化 token 或更改草稿。组件保留原位置，文案统一。已提交引擎的动作不承诺撤回。
