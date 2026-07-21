export const AI_TOOLS = [
  {
    name: "get_overdue_books",
    description: "查询所有逾期未归还的借阅记录",
    parameters: {},
  },
  {
    name: "get_pending_borrows",
    description: "查询当前待审批的借阅数量",
    parameters: {},
  },
  {
    name: "approve_borrow",
    description: "批准指定的借阅申请",
    parameters: {
      borrowId: "string",
    },
  },
  {
    name: "reject_borrow",
    description: "拒绝指定的借阅申请并说明原因",
    parameters: {
      borrowId: "string",
      reason: "string",
    },
  },
  {
    name: "restock_book",
    description: "为指定图书补充库存",
    parameters: {
      bookId: "string",
      delta: "number",
    },
  },
  {
    name: "get_book_stats",
    description: "查询指定图书的借阅统计",
    parameters: {
      bookId: "string",
    },
  },
  {
    name: "get_user_history",
    description: "查询指定用户的借阅历史",
    parameters: {
      userId: "string",
    },
  },
];

export type AiToolName = (typeof AI_TOOLS)[number]["name"];