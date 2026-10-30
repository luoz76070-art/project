# 设计与边界

当前差距：插件engines/peer和网关deepSeekInfo均限定rc.2；桥接info也硬编码rc.2。先核对已安装rc.3包及官方版本门，再验证原接口。

修改范围：plugins/mobile-deepseek的版本声明、真实宿主版本识别和必要API适配；apps/relay/src/agents/deepSeekProtocol.ts的精确白名单；官方运行时检查器和相关隔离回归；说明/交付记录。版本从实际注入的官方LLM包读取，不由手机/私有配置指定。

兼容范围以双版本验证为准，暂定rc.2/rc.3；未通过不得宣称支持。先复现旧包拒绝，再更新。测试运行于独立官方包副本、临时profile和本地确定性adapter，生产状态只作分离的只读验收。

部署：准备固定新插件、网关包和私有备份；原任务空闲后用官方plugin add/HMR加载，验证原进程、唯一监听和配置保持。网关按精确instance stop自然退出后切换。失败恢复旧固定入口和插件链接，不清用户数据。
