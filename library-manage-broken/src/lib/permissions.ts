import type { Role } from "@/lib/enums";

export type Permission =
  | "book:view"
  | "book:create"
  | "book:update"
  | "book:delete"
  | "book:restock"
  | "borrow:request"
  | "borrow:return_own"
  | "borrow:return_any"
  | "borrow:approve"
  | "borrow:reject"
  | "borrow:mark_borrowed"
  | "borrow:view_all"
  | "user:view"
  | "user:create"
  | "user:update_role"
  | "user:deactivate";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  STUDENT: ["book:view", "borrow:request", "borrow:return_own"],
  ADMIN: [
    "book:view",
    "book:create",
    "book:update",
    "book:delete",
    "book:restock",
    "borrow:request",
    "borrow:return_own",
    "borrow:return_any",
    "borrow:approve",
    "borrow:reject",
    "borrow:mark_borrowed",
    "borrow:view_all",
    "user:view",
    "user:create",
    "user:update_role",
    "user:deactivate",
  ],
};

export function hasPermission(role: Role | string | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role as Role];
  if (!perms) return false;
  return perms.includes(permission);
}