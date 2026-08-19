const MOCK_RULES: Array<{ keywords: string[]; reply: string }> = [
  {
    keywords: ["逾期", "超期", "overdue"],
    reply:
      "我已为你查询，目前有 0 条逾期借阅记录（演示数据）。" +
      "逾期规则：超过 dueAt 仍未归还的借阅将自动标记为 OVERDUE，后续可叠加处罚策略。",
  },
  {
    keywords: ["待审批", "审批", "pending"],
    reply:
      "我已为你查询，当前待审批借阅数量为 0（演示数据）。" +
      "你可以在「借阅审批」页面按 requestedAt 升序处理这些申请。",
  },
  {
    keywords: ["补货", "库存", "restock"],
    reply:
      "补货操作路径：图书管理 → 选中图书 → 「补货」按钮 → 输入增量。" +
      "注意：补货会增加 totalCopies 与 availableCopies。",
  },
  {
    keywords: ["排队", "队列", "queue"],
    reply:
      "排队机制：当 availableCopies=0 时，新申请会自动进入 Reservation 表，按 createdAt 升序排列。" +
      "当有用户归还时，队列首位会自动晋升为新的 APPROVED 借阅。",
  },
  {
    keywords: ["你好", "hi", "hello", "在吗"],
    reply:
      "你好！我是图书借阅管理助理（演示版）。" +
      "我可以帮你：查询逾期、查看待审批、补货、审批/拒绝借阅、查询用户历史。" +
      "完整能力将在迭代中接入 MiniMax-M2 后启用。",
  },
  {
    keywords: ["功能", "能做什么", "能力"],
    reply:
      "已注册的工具包括：get_overdue_books / get_pending_borrows / approve_borrow / reject_borrow / restock_book / get_book_stats / get_user_history。" +
      "MVP 阶段为接口预留，回复为 mock；后续接入真实模型后将自动启用工具调用。",
  },
];

export function generateMockReply(prompt: string): string {
  const lower = prompt.toLowerCase();
  for (const rule of MOCK_RULES) {
    if (rule.keywords.some((k) => lower.includes(k.toLowerCase()))) {
      return rule.reply;
    }
  }
  return (
    "我已收到你的问题（mock 回复）。" +
    "在 MVP 阶段，AI Agent 仅保留接口位与 mock 回复。" +
    "你可以尝试询问：逾期、待审批、补货、排队 等关键词。"
  );
}