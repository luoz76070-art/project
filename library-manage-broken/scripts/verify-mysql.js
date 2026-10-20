const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: 'MyRoot@2024', database: 'library-data',
  });
  for (const t of ['users','books','borrows','reservations']) {
    const [rows] = await conn.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
    console.log(`  ${t}: ${rows[0].c}`);
  }
  
  // 对比 SQLite 数据
  console.log('\n=== 数据样本对比 ===');
  const [users] = await conn.query('SELECT username, role, displayName FROM users LIMIT 3');
  console.log('MySQL 用户:');
  users.forEach(u => console.log(`  ${u.username} (${u.role}) - ${u.displayName}`));
  
  const [books] = await conn.query('SELECT title, author, totalCopies, availableCopies FROM books LIMIT 3');
  console.log('\nMySQL 图书:');
  books.forEach(b => console.log(`  ${b.title} (${b.author}) - ${b.availableCopies}/${b.totalCopies}`));
  
  await conn.end();
})();
