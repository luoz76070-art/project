export const Role = {
  STUDENT: "STUDENT",
  ADMIN: "ADMIN",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const ROLE_VALUES = Object.values(Role) as Role[];

export const BorrowStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  BORROWED: "BORROWED",
  RETURNED: "RETURNED",
  OVERDUE: "OVERDUE",
  REJECTED: "REJECTED",
} as const;
export type BorrowStatus = (typeof BorrowStatus)[keyof typeof BorrowStatus];

export const BORROW_STATUS_VALUES = Object.values(BorrowStatus) as BorrowStatus[];

export const BorrowStatusLabel: Record<BorrowStatus, string> = {
  PENDING: "待审批",
  APPROVED: "已批准",
  BORROWED: "已借出",
  RETURNED: "已归还",
  OVERDUE: "已逾期",
  REJECTED: "已拒绝",
};

export const RoleLabel: Record<Role, string> = {
  STUDENT: "学生",
  ADMIN: "管理员",
};