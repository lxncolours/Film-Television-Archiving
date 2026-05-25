/**
 * 批量获取豆瓣电影海报脚本
 *
 * 运行方式: node server/batch_fetch_posters.js
 * 预计耗时: ~25 分钟 (427部电影, 每部间隔3秒)
 *
 * 特点:
 *  - 优先用豆瓣ID精确获取(更可靠)
 *  - 无豆瓣ID的通过片名搜索
 *  - 每次请求间隔 3 秒，避免触发限流
 *  - 遇到 429/403 自动指数退避重试
 *  - 每 20 部保存一次检查点，中断后可续跑
 */

const mysql = require('mysql2/promise');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ===================== 配置 =====================
const API_KEY = '0dad551ec0f84ed02907ff5c42e8ec70';
const API_SECRET = 'bf7dddc7c9cfe6f7';
const USER_AGENTS = [
  'api-client/1 com.douban.frodo/7.22.0.beta9(231) Android/23 product/Mate 40 vendor/HUAWEI model/Mate 40 brand/HUAWEI rom/android network/wifi platform/AndroidPad',
  'api-client/1 com.douban.frodo/7.18.0(230) Android/22 product/MI 9 vendor/Xiaomi model/MI 9 brand/Android rom/miui6 network/wifi platform/mobile nd/1',
  'api-client/1 com.douban.frodo/7.1.0(205) Android/29 product/perseus vendor/Xiaomi model/Mi MIX 3 rom/miui6 network/wifi platform/mobile nd/1',
  'api-client/1 com.douban.frodo/7.3.0(207) Android/22 product/MI 9 vendor/Xiaomi model/MI 9 brand/Android rom/miui6 network/wifi platform/mobile nd/1',
];

const BASE_DELAY_MS = 3000;        // 基本请求间隔
const CHECKPOINT_FILE = path.join(__dirname, 'fetch_progress.json');
const CHECKPOINT_INTERVAL = 20;     // 每处理N部保存一次进度
const MAX_RETRIES = 3;              // 最大重试次数

// ===================== 工具函数 =====================
function getTS() {
  const n = new Date();
  return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;
}

function sign(pathname, ts) {
  const raw = `GET&${encodeURIComponent(pathname)}&${ts}`;
  return crypto.createHmac('sha1', API_SECRET).update(raw).digest('base64');
}

function getUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===================== 核心API调用 =====================
async function doubanGet(pathname, params, attempt = 1) {
  const ts = getTS();
  const url = new URL(pathname, 'https://frodo.douban.com');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('apiKey', API_KEY);
  url.searchParams.set('os_rom', 'android');
  url.searchParams.set('_ts', ts);
  url.searchParams.set('_sig', sign(pathname, ts));

  try {
    const res = await axios.get(url.toString(), {
      headers: { 'User-Agent': getUA() },
      timeout: 10000,
    });
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    // 429=限流, 403=被拒 — 退避重试
    if ((status === 429 || status === 403) && attempt <= MAX_RETRIES) {
      const wait = Math.min(10000 * Math.pow(2, attempt - 1), 60000);
      console.log(`  ⏳ 遇到 ${status}，等待 ${wait/1000}s 后第 ${attempt+1} 次重试...`);
      await sleep(wait);
      return doubanGet(pathname, params, attempt + 1);
    }
    throw err;
  }
}

// ===================== 主逻辑 =====================
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     🎬 豆瓣电影海报批量获取工具         ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // 1. 连接数据库
  const pool = mysql.createPool({
    host: 'localhost', user: 'libereica', password: 'L1ber1ca',
    database: 'movie_archive', waitForConnections: true, connectionLimit: 5,
  });

  // 2. 读取检查点（支持续跑）
  let checkpoint = { processed: 0, success: 0, failed: 0 };
  if (fs.existsSync(CHECKPOINT_FILE)) {
    try {
      checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
      console.log(`📋 检测到检查点：已处理 ${checkpoint.processed} 部`);
      console.log(`   ✅ 成功: ${checkpoint.success}  ❌ 失败: ${checkpoint.failed}\n`);
    } catch (e) { /* ignore */ }
  }

  // 3. 获取所有需要海报的电影
  const limitClause = process.argv.includes('--test') ? ' LIMIT 5' : '';
  const [rows] = await pool.query(
    `SELECT id, title, altTitle, doubanUrl FROM movies WHERE poster_data IS NULL OR poster_data = '' ORDER BY id ASC${limitClause}`
  );
  console.log(`📊 共 ${rows.length} 部电影需要获取海报`);
  
  const withId = rows.filter(r => r.doubanUrl?.includes('subject/'));
  const withoutId = rows.filter(r => !r.doubanUrl?.includes('subject/'));
  console.log(`   📌 有豆瓣ID: ${withId.length} (精确获取)`);
  console.log(`   🔍 无豆瓣ID: ${withoutId.length} (搜索匹配)`);

  // 排序：有豆瓣ID的优先处理
  const sorted = [...withId, ...withoutId];
  const toProcess = sorted.slice(checkpoint.processed);

  if (toProcess.length === 0) {
    console.log('\n✅ 所有电影已完成！');
    await pool.end();
    if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE);
    return;
  }

  console.log(`\n⏳ 开始处理 ${toProcess.length} 部 (跳过已处理的 ${checkpoint.processed} 部)`);
  console.log(`   ⏱️  预计耗时: ~${Math.ceil(toProcess.length * BASE_DELAY_MS / 60000)} 分钟\n`);

  let processed = checkpoint.processed;
  let success = checkpoint.success;
  let failed = checkpoint.failed;
  let consecutiveErrors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const movie = toProcess[i];
    const idx = processed + i + 1;
    const progress = `${idx}/${rows.length}`;

    // 提取豆瓣ID
    let doubanId = null;
    if (movie.doubanUrl) {
      const m = movie.doubanUrl.match(/subject\/(\d+)/);
      if (m) doubanId = m[1];
    }

    process.stdout.write(`[${progress}] ${movie.title}`);

    try {
      let posterUrl = null;

      // === 方案A: TMDB搜索 ===
      try {
        const tmdb = require('./tmdb');
        if (tmdb.isConfigured()) {
          posterUrl = await tmdb.findPosterByTitle(movie.title, movie.altTitle, movie.doubanUrl);
        }
      } catch (e) {
        console.log(`  ⚠️ TMDB获取失败: ${e.message}`);
      }

      if (!posterUrl && doubanId) {
        // === 方案B: 豆瓣网页抓取 ===
        try {
          const doubanScraper = require('./douban_scraper');
          posterUrl = await doubanScraper.scrapePoster(doubanId);
        } catch (e) {
          console.log(`  ⚠️ 豆瓣抓取失败: ${e.message}`);
        }
      }

      if (posterUrl) {
        // 下载图片二进制并存到 poster_data
        let imageData = null;
        let imageMime = '';
        try {
          const imgResp = await axios.get(posterUrl, {
            responseType: 'arraybuffer',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': 'https://movie.douban.com/',
            },
            timeout: 15000,
          });
          imageData = Buffer.from(imgResp.data);
          imageMime = imgResp.headers['content-type'] || 'image/jpeg';
        } catch (e) {
          console.log(`  ⚠️ 图片下载失败: ${e.message}`);
        }

        if (imageData) {
          await pool.query('UPDATE movies SET poster = ?, poster_data = ?, poster_mime = ? WHERE id = ?',
            [posterUrl, imageData, imageMime, movie.id]);
          console.log(`  ✅ 海报已保存（含图片数据）`);
        } else {
          await pool.query('UPDATE movies SET poster = ? WHERE id = ?', [posterUrl, movie.id]);
          console.log(`  ✅ 海报URL已保存（图片下载失败）`);
        }
        success++;
        consecutiveErrors = 0;
      } else {
        console.log(`  ❌ 未找到海报`);
        failed++;
        consecutiveErrors = 0;
      }
    } catch (err) {
      const status = err.response?.status || err.code;
      console.log(`  ❌ 错误: ${status} ${err.message}`);
      failed++;
      consecutiveErrors++;

      // 连续失败太多，说明已被彻底限流，暂停更久
      if (consecutiveErrors >= 5) {
        console.log(`\n⚠️  连续 ${consecutiveErrors} 次失败，暂停 60 秒...`);
        await sleep(60000);
        consecutiveErrors = 0;
      }
    }

    // 保存检查点
    const cumulative = processed + i + 1;
    if ((i + 1) % CHECKPOINT_INTERVAL === 0 || i === toProcess.length - 1) {
      fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({
        processed: cumulative, success, failed, lastUpdated: new Date().toISOString(),
      }));
    }

    // 显示进度统计
    if ((i + 1) % CHECKPOINT_INTERVAL === 0) {
      const pct = ((cumulative / rows.length) * 100).toFixed(1);
      console.log(`\n📊 进度: ${cumulative}/${rows.length} (${pct}%) | 成功: ${success} | 失败: ${failed}`);
    }

    // 请求间隔
    if (i < toProcess.length - 1) {
      await sleep(BASE_DELAY_MS + Math.random() * 1000);
    }
  }

  // 最终统计
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║              🎉 完成！                   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`   总计: ${rows.length}  成功: ${success}  失败: ${failed}`);
  console.log(`   成功率: ${((success / rows.length) * 100).toFixed(1)}%`);
  
  // 清理检查点
  if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE);
  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
