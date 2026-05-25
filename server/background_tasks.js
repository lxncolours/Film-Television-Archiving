const mysql = require('mysql2/promise');
const axios = require('axios');
const https = require('https');
const tmdb = require('./tmdb');
const doubanScraper = require('./douban_scraper');

const CONFIG = {
  intervalMs: 30000, // 每半分钟执行一次
  proxy: { host: '127.0.0.1', port: 6789 },
  dbConfig: {
    host: 'localhost',
    user: 'libereica',
    password: 'L1ber1ca',
    database: 'movie_archive',
    waitForConnections: true,
    connectionLimit: 5,
  },
};

const AGENT = new https.Agent({ rejectUnauthorized: false });
const proxyAxios = axios.create({
  proxy: CONFIG.proxy,
  httpsAgent: AGENT,
  timeout: 15000,
});

let pool = null;
let taskRunning = false;
let taskInterval = null;
let stats = { processed: 0, success: 0, failed: 0, lastRun: null };

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getPool() {
  if (!pool) {
    pool = mysql.createPool(CONFIG.dbConfig);
  }
  return pool;
}

async function fetchOnePoster() {
  const pool = await getPool();

  // 1. 获取一部需要海报的电影（优先选有豆瓣ID的，跳过已标记的和已有海报URL的）
    const [rows] = await pool.query(
      "SELECT id, title, altTitle, doubanUrl, type FROM movies WHERE (poster_data IS NULL OR poster_data = '') AND (poster IS NULL OR poster = '' OR poster = '_not_found_') ORDER BY doubanUrl DESC, id ASC LIMIT 1"
    );

  if (rows.length === 0) {
    console.log('[Background] 没有需要获取海报的电影');
    return false;
  }

  const movie = rows[0];
  console.log(`[Background] 正在获取: ${movie.title}`);

  let posterUrl = null;

  try {
    // 2. 提取豆瓣ID
    let doubanId = null;
    if (movie.doubanUrl) {
      const m = movie.doubanUrl.match(/subject\/(\d+)/);
      if (m) doubanId = m[1];
    }

    // 3. 尝试 TMDB
    if (!posterUrl && tmdb.isConfigured()) {
      try {
        posterUrl = await tmdb.findPosterByTitle(movie.title, movie.altTitle, movie.doubanUrl, movie.type);
        if (posterUrl) console.log(`  ✅ TMDB 找到海报`);
      } catch (e) {
        console.log(`  ⚠️ TMDB 失败: ${e.message}`);
      }
    }

    // 4. 尝试豆瓣网页抓取
    if (!posterUrl && doubanId) {
      try {
        posterUrl = await doubanScraper.scrapePoster(doubanId);
        if (posterUrl) console.log(`  ✅ 豆瓣抓取成功`);
      } catch (e) {
        console.log(`  ⚠️ 豆瓣抓取失败: ${e.message}`);
      }
    }

    // 5. 如果所有方式都失败，标记为已尝试过，避免重复处理
    if (!posterUrl) {
      await pool.query("UPDATE movies SET poster = '_not_found_' WHERE id = ?", [movie.id]);
      console.log(`  ❌ ${movie.title} 未找到海报，已标记跳过`);
      stats.failed++;
      stats.processed++;
      stats.lastRun = new Date();
      return true;
    }

    // 6. 下载并保存海报
    let imageData = null;
    let imageMime = '';
    try {
      const imgResp = await proxyAxios.get(posterUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://movie.douban.com/',
        },
      });
      imageData = Buffer.from(imgResp.data);
      imageMime = imgResp.headers['content-type'] || 'image/jpeg';
    } catch (e) {
      console.log(`  ⚠️ 图片下载失败: ${e.message}`);
    }

    if (imageData) {
      await pool.query(
        'UPDATE movies SET poster = ?, poster_data = ?, poster_mime = ? WHERE id = ?',
        [posterUrl, imageData, imageMime, movie.id]
      );
      console.log(`  ✅ ${movie.title} 海报已保存（含图片）`);
    } else {
      await pool.query('UPDATE movies SET poster = ? WHERE id = ?', [posterUrl, movie.id]);
      console.log(`  ✅ ${movie.title} 海报URL已保存`);
    }

    stats.success++;
    stats.processed++;
    stats.lastRun = new Date();
    return true;

  } catch (err) {
    console.log(`  ❌ ${movie.title} 错误: ${err.message}`);
    stats.failed++;
    stats.lastRun = new Date();
    return false;
  }
}

async function runTask() {
  if (taskRunning) {
    console.log('[Background] 上一次任务仍在执行中，跳过此次');
    return;
  }

  taskRunning = true;
  try {
    await fetchOnePoster();
  } catch (err) {
    console.error('[Background] 任务异常:', err);
  } finally {
    taskRunning = false;
  }
}

function start() {
  if (taskInterval) {
    console.log('[Background] 任务已在运行中');
    return;
  }

  console.log(`[Background] 启动后台任务，每 ${CONFIG.intervalMs / 1000} 秒获取一部海报`);
  
  // 立即执行一次
  runTask();
  
  // 设置定时任务
  taskInterval = setInterval(runTask, CONFIG.intervalMs);
}

function stop() {
  if (taskInterval) {
    clearInterval(taskInterval);
    taskInterval = null;
    console.log('[Background] 后台任务已停止');
  }
}

function getStats() {
  return { ...stats, running: !!taskInterval, interval: CONFIG.intervalMs };
}

module.exports = { start, stop, getStats };
