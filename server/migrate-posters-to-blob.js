const mysql = require('mysql2/promise');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const MIGRATION_FILE = path.join(__dirname, 'migrate_blob_progress.json');
const CHECKPOINT_INTERVAL = 10;
const DELAY_MS = 2000;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const pool = mysql.createPool({
    host: 'localhost', user: 'libereica', password: 'L1ber1ca',
    database: 'movie_archive', connectionLimit: 5,
  });

  let checkpoint = { processed: 0, success: 0, failed: 0, skipped: 0 };
  if (fs.existsSync(MIGRATION_FILE)) {
    try {
      checkpoint = JSON.parse(fs.readFileSync(MIGRATION_FILE, 'utf8'));
      console.log(`📋 恢复检查点：已处理 ${checkpoint.processed}`);
    } catch (e) { /* ignore */ }
  }

  const [rows] = await pool.query(
    "SELECT id, title, poster FROM movies WHERE poster IS NOT NULL AND poster != '' AND (poster_data IS NULL OR poster_data = '') ORDER BY id ASC"
  );

  console.log(`📊 需要下载海报图片的电影: ${rows.length}`);

  if (rows.length === 0) {
    console.log('✅ 所有海报图片已持久化');
    await pool.end();
    return;
  }

  const toProcess = rows.slice(checkpoint.processed);
  console.log(`⏳ 从第 ${checkpoint.processed + 1} 部开始处理 (跳过已处理的 ${checkpoint.processed} 部)`);

  let { processed, success, failed, skipped } = checkpoint;

  for (let i = 0; i < toProcess.length; i++) {
    const movie = toProcess[i];
    const idx = processed + i + 1;

    process.stdout.write(`[${idx}/${rows.length}] ${movie.title}`);

    try {
      const resp = await axios.get(movie.poster, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://movie.douban.com/',
        },
        timeout: 15000,
      });

      const mime = resp.headers['content-type'] || 'image/jpeg';
      const imgData = Buffer.from(resp.data);

      await pool.query(
        'UPDATE movies SET poster_data = ?, poster_mime = ? WHERE id = ?',
        [imgData, mime, movie.id]
      );
      console.log(` ✅ (${(imgData.length / 1024).toFixed(0)}KB)`);
      success++;
    } catch (e) {
      const status = e.response?.status || e.code;
      console.log(` ❌ ${status} ${e.message.slice(0, 50)}`);
      failed++;
    }

    if ((i + 1) % CHECKPOINT_INTERVAL === 0 || i === toProcess.length - 1) {
      const cumulative = processed + i + 1;
      fs.writeFileSync(MIGRATION_FILE, JSON.stringify({
        processed: cumulative, success, failed, skipped,
        lastUpdated: new Date().toISOString(),
      }));
      const pct = ((cumulative / rows.length) * 100).toFixed(1);
      console.log(`\n📊 进度: ${cumulative}/${rows.length} (${pct}%) | ✅ ${success} | ❌ ${failed}`);
    }

    if (i < toProcess.length - 1) {
      await sleep(DELAY_MS + Math.random() * 1000);
    }
  }

  console.log(`\n🎉 迁移完成！成功: ${success}, 失败: ${failed}`);
  if (fs.existsSync(MIGRATION_FILE)) fs.unlinkSync(MIGRATION_FILE);
  await pool.end();
}

main();
