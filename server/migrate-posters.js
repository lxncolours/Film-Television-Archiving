/**
 * 一次性迁移：把 movies.poster_data（MEDIUMBLOB）落到本地文件系统 data/posters/
 *
 * 背景：海报存 BLOB 导致带图数据导入导出极慢——
 *   导出需全表拉 BLOB 转 base64 塞单个 JSON；导入需逐条 UPDATE BLOB（走 Tailscale 高延迟）。
 * 迁移后 DB 仅存 poster_file 文件名，poster_data 清空释放空间。
 *
 * 幂等：poster_data 已为空的行自动跳过，可重复执行。
 * 用法：node server/migrate-posters.js
 */
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const posterStore = require('./utils/posterStore');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'movie_archive',
  });

  const [rows] = await conn.query(
    'SELECT id, poster_data, poster_mime FROM movies WHERE poster_data IS NOT NULL AND poster_data != \'\''
  );
  console.log(`待迁移海报记录: ${rows.length} 条`);

  if (rows.length === 0) {
    console.log('无需迁移，退出');
    await conn.end();
    return;
  }

  posterStore.ensureDir();
  let ok = 0, fail = 0;
  for (const row of rows) {
    try {
      const fileName = posterStore.savePoster(Buffer.from(row.poster_data), row.poster_mime);
      if (!fileName) throw new Error('savePoster returned null');
      await conn.query('UPDATE movies SET poster_file = ?, poster_data = NULL, poster_mime = NULL WHERE id = ?',
        [fileName, row.id]);
      ok++;
    } catch (e) {
      console.error(`  ✗ id=${row.id} 迁移失败: ${e.message}`);
      fail++;
    }
  }
  console.log(`迁移完成: 成功 ${ok} 条${fail > 0 ? `，失败 ${fail} 条（可重跑重试）` : ''}，海报目录: ${posterStore.posterDir()}`);
  await conn.end();
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
