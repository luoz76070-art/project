# 实施

1. 安装指定依赖，取回 origin/main 并建分支。
2. A1 palette 与 classic、语义桥映射，逐字段审计/对比度及 Flutter 测试源码同步，提交一。
3. 网页 token、host 接收、合成 fixture、回归测试，执行 test:mobile/typecheck/lint。
4. 构建本地合成页并通过受控浏览器检查；如权限阻止则报告，不绕过。
5. 提交二并推送，PR 附颜色表、旧值映射和验证证据。
