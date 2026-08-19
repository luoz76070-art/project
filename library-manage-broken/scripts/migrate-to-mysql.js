const mysql = require('mysql2/promise');
const fs = require('fs');

async function main() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: 'MyRoot@2024', database: 'library-data',
  });
  
  const data = JSON.parse(fs.readFileSync('/mnt/luozhe/mysql/backups/sqlite-export.json', 'utf8'));
  console.log('=== 数据迁移开始 ===');
  console.log('源数据:', JSON.stringify({
    users: data.users.length, books: data.books.length,
    borrows: data.borrows.length, reservations: data.reservations.length,
  }));

  // 1. users
  console.log('\n→ 导入 users...');
  for (const u of data.users) {
    await conn.query(
      `INSERT INTO users (id, username, passwordHash, displayName, role, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)`,
      [u.id, u.username, u.passwordHash, u.displayName, u.role, u.isActive, new Date(u.createdAt), new Date(u.updatedAt)]
    );
  }
  console.log(`  ✅ users: ${data.users.length}`);

  // 2. books
  console.log('\n→ 导入 books...');
  for (const b of data.books) {
    await conn.query(
      `INSERT INTO books (id, title, author, isbn, category, description, coverUrl, totalCopies, availableCopies, isActive, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.id, b.title, b.author, b.isbn, b.category, b.description, b.coverUrl, b.totalCopies, b.availableCopies, b.isActive, new Date(b.createdAt), new Date(b.updatedAt)]
    );
  }
  console.log(`  ✅ books: ${data.books.length}`);

  // 3. borrows
  console.log('\n→ 导入 borrows...');
  for (const b of data.borrows) {
    await conn.query(
      `INSERT INTO borrows (id, userId, bookId, status, requestedDays, requestedAt, approvedAt, borrowedAt, dueAt, returnedAt, rejectReason) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [b.id, b.userId, b.bookId, b.status, b.requestedDays, new Date(b.requestedAt),
       b.approvedAt ? new Date(b.approvedAt) : null,
       b.borrowedAt ? new Date(b.borrowedAt) : null,
       b.dueAt ? new Date(b.dueAt) : null,
       b.returnedAt ? new Date(b.returnedAt) : null,
       b.rejectReason]
    );
  }
  console.log(`  ✅ borrows: ${data.borrows.length}`);

  // 4. reservations
  console.log('\n→ 导入 reservations...');
  for (const r of data.reservations) {
    await conn.query(
      `INSERT INTO reservations (id, userId, bookId, queuePosition, createdAt, fulfilledAt) VALUES (?,?,?,?,?,?)`,
      [r.id, r.userId, r.bookId, r.queuePosition, new Date(r.createdAt),
       r.fulfilledAt ? new Date(r.fulfilledAt) : null]
    );
  }
  console.log(`  ✅ reservations: ${data.reservations.length}`);

  console.log('\n=== ✅ 迁移完成 ===');
  await conn.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
