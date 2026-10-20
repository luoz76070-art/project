const mysql = require('mysql2/promise');
const fs = require('fs');

async function dumpDatabase(conn, dbName) {
  const [tables] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
    [dbName]
  );

  let sql = '';
  sql += `--\n-- Database: ${dbName}\n--\n`;
  sql += `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n`;
  sql += `USE \`${dbName}\`;\n\n`;

  // 关闭外键检查
  sql += `SET FOREIGN_KEY_CHECKS = 0;\n\n`;

  for (const t of tables) {
    const tableName = t.TABLE_NAME;

    // 获取建表语句
    const [createRes] = await conn.query(`SHOW CREATE TABLE \`${dbName}\`.\`${tableName}\``);
    const createSQL = createRes[0]['Create Table'];
    sql += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
    sql += createSQL + ';\n\n';

    // 获取数据
    const [rows] = await conn.query(
      `SELECT * FROM \`${dbName}\`.\`${tableName}\``
    );

    if (rows.length > 0) {
      const cols = Object.keys(rows[0]);
      const values = rows.map(row => {
        const vals = cols.map(c => {
          const v = row[c];
          if (v === null) return 'NULL';
          if (typeof v === 'number') return v;
          if (v instanceof Date) return `'${v.toISOString().slice(0,19).replace('T',' ')}'`;
          return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
        });
        return `(${vals.join(', ')})`;
      });
      sql += `INSERT INTO \`${tableName}\` (${cols.map(c => `\`${c}\``).join(', ')}) VALUES\n`;
      sql += values.join(',\n') + ';\n\n';
    }
  }

  sql += `SET FOREIGN_KEY_CHECKS = 1;\n`;
  return sql;
}

async function main() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: 'MyRoot@2024',
  });

  const [dbs] = await conn.query("SHOW DATABASES");
  const targetDBs = dbs
    .map(d => d.Database)
    .filter(d => !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(d));

  console.log('目标数据库:', targetDBs);

  let fullDump = '';
  fullDump += `-- =============================================\n`;
  fullDump += `-- luozhe-mysql 数据库导出\n`;
  fullDump += `-- 导出时间: ${new Date().toISOString()}\n`;
  fullDump += `-- MySQL: ${(await conn.query('SELECT VERSION() AS v'))[0][0].v}\n`;
  fullDump += `-- 数据库: ${targetDBs.join(', ')}\n`;
  fullDump += `-- =============================================\n\n`;

  for (const db of targetDBs) {
    console.log(`\n→ 导出 ${db}...`);
    fullDump += await dumpDatabase(conn, db);
  }

  const outPath = '/mnt/luozhe/mysql/luozhe-mysql/dump-all-databases.sql';
  fs.writeFileSync(outPath, fullDump);
  console.log('\n✅ 导出完成:', outPath);
  console.log('  大小:', (fullDump.length / 1024).toFixed(1) + ' KB');

  await conn.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
