import { PrismaClient, Role, BorrowStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  console.log("🌱 开始写入种子数据...");

  // 清理所有表（MySQL 版本）
  await db.reservation.deleteMany();
  await db.borrow.deleteMany();
  await db.book.deleteMany();
  await db.user.deleteMany();

  const passwordHash = await bcrypt.hash("pass1234", 10);
  const adminHash = await bcrypt.hash("admin1234", 10);

  await db.user.createMany({
    data: [
      { username: "admin", passwordHash: adminHash, displayName: "系统管理员", role: Role.ADMIN },
      { username: "student1", passwordHash, displayName: "张同学", role: Role.STUDENT },
      { username: "student2", passwordHash, displayName: "李同学", role: Role.STUDENT },
      { username: "student3", passwordHash, displayName: "王同学", role: Role.STUDENT },
      { username: "student4", passwordHash, displayName: "陈同学", role: Role.STUDENT },
      { username: "student5", passwordHash, displayName: "刘同学", role: Role.STUDENT },
    ],
  });

  const books = [
    { title: "三体", author: "刘慈欣", category: "文学", totalCopies: 3 },
    { title: "活着", author: "余华", category: "文学", totalCopies: 2 },
    { title: "算法导论", author: "Thomas H. Cormen", category: "计算机", totalCopies: 2 },
    { title: "深入理解计算机系统", author: "Randal E. Bryant", category: "计算机", totalCopies: 2 },
    { title: "人类简史", author: "尤瓦尔·赫拉利", category: "历史", totalCopies: 2 },
    { title: "万历十五年", author: "黄仁宇", category: "历史", totalCopies: 1 },
    { title: "苏菲的世界", author: "乔斯坦·贾德", category: "哲学", totalCopies: 2 },
    { title: "中国哲学简史", author: "冯友兰", category: "哲学", totalCopies: 1 },
    { title: "艺术的故事", author: "E.H.贡布里希", category: "艺术", totalCopies: 1 },
    { title: "时间简史", author: "史蒂芬·霍金", category: "科学", totalCopies: 2 },
  ];

  for (const b of books) {
    await db.book.create({
      data: {
        title: b.title,
        author: b.author,
        category: b.category,
        totalCopies: b.totalCopies,
        availableCopies: 0,
        isActive: true,
      },
    });
  }

  const allBooks = await db.book.findMany();
  const students = await db.user.findMany({ where: { role: Role.STUDENT } });

  // 让所有书初始可借
  for (const b of allBooks) {
    await db.book.update({
      where: { id: b.id },
      data: { availableCopies: b.totalCopies },
    });
  }

  // 让 2 本书变成库存为 0
  const noStock1 = allBooks[5];
  const noStock2 = allBooks[7];
  await db.book.update({ where: { id: noStock1.id }, data: { availableCopies: 0 } });
  await db.book.update({ where: { id: noStock2.id }, data: { availableCopies: 0 } });

  // 排队
  await db.reservation.create({
    data: {
      userId: students[1].id,
      bookId: noStock1.id,
      queuePosition: 1,
    },
  });
  await db.reservation.create({
    data: {
      userId: students[2].id,
      bookId: noStock1.id,
      queuePosition: 2,
    },
  });

  // 待审批借阅
  await db.borrow.create({
    data: {
      userId: students[0].id,
      bookId: allBooks[0].id,
      status: BorrowStatus.PENDING,
      requestedDays: 30,
    },
  });
  await db.book.update({
    where: { id: allBooks[0].id },
    data: { availableCopies: allBooks[0].availableCopies - 1 },
  });

  console.log("✅ 种子数据写入完成");
  console.log("📊 用户: 1 admin + 5 students");
  console.log("📚 图书: 10 本");
  console.log("⏳ 排队: 2 条");
  console.log("📝 待审批借阅: 1 条");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });