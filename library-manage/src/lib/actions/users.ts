"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin, requireSession } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { BorrowStatus, Role, ROLE_VALUES } from "@/lib/enums";

const ACTIVE_STATUSES = [
  BorrowStatus.PENDING,
  BorrowStatus.APPROVED,
  BorrowStatus.BORROWED,
  BorrowStatus.OVERDUE,
];

export async function listUsers() {
  await requireAdmin();
  return db.user.findMany({ orderBy: [{ createdAt: "desc" }] });
}

const createUserSchema = z.object({
  username: z
    .string()
    .min(3, "至少 3 个字符")
    .max(40)
    .regex(/^[a-zA-Z0-9_]+$/, "仅字母数字下划线"),
  password: z.string().min(6, "至少 6 位"),
  displayName: z.string().min(1, "不能为空").max(60),
  role: z.enum(ROLE_VALUES as [Role, ...Role[]]),
});

export async function createUser(input: z.infer<typeof createUserSchema>) {
  await requireAdmin();
  if (!hasPermission(Role.ADMIN, "user:create")) return { ok: false as const, error: "无权限" };

  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.errors[0]?.message ?? "参数错误" };

  const exists = await db.user.findUnique({ where: { username: parsed.data.username } });
  if (exists) return { ok: false as const, error: "用户名已存在" };

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await db.user.create({
    data: {
      username: parsed.data.username,
      passwordHash,
      displayName: parsed.data.displayName,
      role: parsed.data.role,
    },
  });

  revalidatePath("/admin/users");
  return { ok: true as const, message: "用户已创建" };
}

export async function updateUserRole(userId: string, role: Role) {
  await requireAdmin();
  if (!hasPermission(Role.ADMIN, "user:update_role")) return { ok: false as const, error: "无权限" };
  if (!ROLE_VALUES.includes(role)) return { ok: false as const, error: "角色无效" };

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) return { ok: false as const, error: "用户不存在" };

  await db.user.update({ where: { id: userId }, data: { role } });
  revalidatePath("/admin/users");
  return { ok: true as const, message: "角色已更新" };
}

export async function setUserActive(userId: string, isActive: boolean) {
  await requireAdmin();
  if (!hasPermission(Role.ADMIN, "user:deactivate")) return { ok: false as const, error: "无权限" };

  await db.user.update({ where: { id: userId }, data: { isActive } });
  revalidatePath("/admin/users");
  return { ok: true as const };
}

export async function getMyBorrows() {
  const session = await requireSession();
  const userId = session.user.id;

  const [active, history, reservations] = await Promise.all([
    db.borrow.findMany({
      where: { userId, status: { in: ACTIVE_STATUSES } },
      include: { book: true },
      orderBy: { requestedAt: "desc" },
    }),
    db.borrow.findMany({
      where: { userId, status: { in: [BorrowStatus.RETURNED, BorrowStatus.REJECTED] } },
      include: { book: true },
      orderBy: { returnedAt: "desc" },
      take: 50,
    }),
    db.reservation.findMany({
      where: { userId, fulfilledAt: null },
      include: { book: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return { active, history, reservations };
}