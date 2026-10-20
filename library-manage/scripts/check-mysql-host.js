const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', port: 3306, user: 'root', password: 'MyRoot@2024'
  });
  
  const [v] = await conn.query('SELECT VERSION() AS v');
  console.log('MySQL 版本:', v[0].v);
  
  const [vars] = await conn.query(
    "SHOW VARIABLES WHERE Variable_name IN ('version_compile_os','datadir','socket','hostname','port')"
  );
  console.log('\n关键变量:');
  vars.forEach(r => console.log('  ' + r.Variable_name + ': ' + r.Value));
  
  const [dbs] = await conn.query('SHOW DATABASES');
  console.log('\n数据库:');
  dbs.forEach(d => console.log('  ' + d.Database));
  
  const [proc] = await conn.query('SELECT USER, HOST, DB, COMMAND FROM information_schema.processlist LIMIT 5');
  console.log('\n活动连接:');
  proc.forEach(p => console.log('  ' + p.USER + '@' + p.HOST));
  
  await conn.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
