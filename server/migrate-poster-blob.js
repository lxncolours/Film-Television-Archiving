const mysql = require('mysql2/promise');
(async () => {
  const pool = mysql.createPool({
    host: 'localhost', user: 'libereica', password: 'L1ber1ca',
    database: 'movie_archive', connectionLimit: 5,
  });
  try {
    await pool.query("ALTER TABLE movies ADD COLUMN poster_data MEDIUMBLOB DEFAULT NULL AFTER poster");
    console.log('✅ 添加 poster_data 列成功');
  } catch (e) {
    if (e.errno === 1060) console.log('ℹ️  poster_data 列已存在，跳过');
    else throw e;
  }
  try {
    await pool.query("ALTER TABLE movies ADD COLUMN poster_mime VARCHAR(50) DEFAULT '' AFTER poster_data");
    console.log('✅ 添加 poster_mime 列成功');
  } catch (e) {
    if (e.errno === 1060) console.log('ℹ️  poster_mime 列已存在，跳过');
    else throw e;
  }
  console.log('🎉 迁移完成');
  await pool.end();
})();
