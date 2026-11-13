# W1 事项存储与状态机
实现 todo/in_progress/to_verify/done/returned 五态；只有用户验收接口可进入 done，系统与 Agent 内部回写不能完成。工作区配对设备共享事项，撤销沿用 D2。interrupted 退回并保留取消原因，用户可重新打开 done 并产生新 attempt。
范围：共享类型、状态机、持久存储、REST/SSE、旧 Web/原生交接迁移、卡片“完成”改“关闭”。不实现捕获、派发、自动回写、事项页或保留清理。
上限：标题200字、detail64KiB、冻结正文96KiB、16附件/每个25MiB、32代码引用、单项256KiB、1000项/文件32MiB；满额拒绝不淘汰。
