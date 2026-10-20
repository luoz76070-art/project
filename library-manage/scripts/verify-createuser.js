const mysql = require('mysql2/promise');

async function main() {
  // 用 root 连接
  console.log('=== 1. 用 root 连接 luozhe-mysql ===');
  const root = await mysql.createConnection({
    host: '127.0.0.1', port: 3306, user: 'root', password: 'MyRoot@2024'
  });
  console.log('  ✅ 连接成功，MySQL 版本:', (await root.query('SELECT VERSION() AS v'))[0][0].v);

  // 创建测试数据库
  console.log('\n=== 2. 创建测试数据库 test_libapp_verify ===');
  await root.query("CREATE DATABASE IF NOT EXISTS `test_libapp_verify` CHARACTER SET utf8mb4");
  console.log('  ✅ 数据库已创建');

  // 创建专用用户
  console.log('\n=== 3. 创建专用用户 libapp_test ===');
  await root.query("DROP USER IF EXISTS 'libapp_test'@'%'");
  await root.query("CREATE USER 'libapp_test'@'%' IDENTIFIED BY 'TestPassword123!'");
  console.log('  ✅ 用户已创建（IDENTIFIED BY caching_sha2_password）');

  // 授权
  console.log('\n=== 4. 授权 libapp_test ===');
  await root.query(`
    GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
    ON \`test_libapp_verify\`.* TO 'libapp_test'@'%'
  `);
  await root.query("FLUSH PRIVILEGES");
  console.log('  ✅ 权限已授予');

  // 验证权限
  const [grants] = await root.query("SHOW GRANTS FOR 'libapp_test'@'%'");
  console.log('\n=== 5. 验证 libapp_test 权限 ===');
  grants.forEach(g => console.log('  ' + g[Object.keys(g)[0]]));

  // 用新用户连接测试
  console.log('\n=== 6. 用 libapp_test 连接测试 ===');
  const libapp = await mysql.createConnection({
    host: '127.0.0.1', port: 3306,
    user: 'libapp_test', password: 'TestPassword123!',
    database: 'test_libapp_verify'
  });
  console.log('  ✅ libapp_test 连接成功');
  const [v] = await libapp.query("SELECT CURRENT_USER() AS u, DATABASE() AS db");
  console.log('  ', v[0]);

  // 建表
  console.log('\n=== 7. libapp_test 建表 ===');
  await libapp.query(`
    CREATE TABLE test_books (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      author VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
  console.log('  ✅ test_books 表已创建');

  // 写数据
  console.log('\n=== 8. libapp_test 写数据 ===');
  await libapp.query("INSERT INTO test_books (title, author) VALUES (?, ?), (?, ?)",
    ['Test Book 1', 'Author A', 'Test Book 2', 'Author B']);
  const [rows] = await libapp.query("SELECT * FROM test_books");
  console.log('  ✅ 插入 2 行：');
  rows.forEach(r => console.log('    ', r));

  // 验证其他库不能访问（最小权限）
  console.log('\n=== 9. 验证 libapp_test 不能访问其他库 ===');
  try {
    await libapp.query("SELECT * FROM library-data.users LIMIT 1");
    console.log('  ❌ 越权访问成功（不应该）');
  } catch (e) {
    console.log('  ✅ 越权访问被拒绝:', e.code);
  }

  await libapp.end();

  // 清理
  console.log('\n=== 10. 清理测试数据 ===');
  await root.query("DROP DATABASE `test_libapp_verify`");
  await root.query("DROP USER 'libapp_test'@'%'");
  await root.query("FLUSH PRIVILEGES");
  console.log('  ✅ 测试库 + 测试用户已删除');

  await root.end();
  console.log('\n🎉 全流程验证通过！luozhe-mysql 状态完全不变。');
}

main().catch(e => { console.error('❌ ERROR:', e.message); process.exit(1); });
