const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: 'MyRoot@2024', database: 'library-data',
  });
  const [tables] = await conn.query('SHOW TABLES');
  console.log('Tables:', tables.map(t => Object.values(t)[0]));
  for (const t of tables) {
    const name = Object.values(t)[0];
    if (['users','books','borrows','reservations'].includes(name)) {
      const [cols] = await conn.query(`SHOW COLUMNS FROM \`${name}\``);
      console.log(`\n${name}:`);
      cols.forEach(c => console.log(`  ${c.Field} ${c.Type}${c.Null === 'NO' ? ' NOT NULL' : ''}`));
    }
  }
  await conn.end();
})();
