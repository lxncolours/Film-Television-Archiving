const mysql = require('mysql2/promise');
const axios = require('axios');
const crypto = require('crypto');

const API_KEY = '0dad551ec0f84ed02907ff5c42e8ec70';
const API_SECRET = 'bf7dddc7c9cfe6f7';
const FRODO_BASE = 'https://frodo.douban.com';
const USER_AGENT = 'api-client/1 com.douban.frodo/7.22.0.beta9(231) Android/23 product/Mate 40 vendor/HUAWEI model/Mate 40 brand/HUAWEI rom/android network/wifi platform/AndroidPad';

function getTS() {
  const n = new Date();
  return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;
}

function sign(urlPath, ts) {
  const raw = `GET&${encodeURIComponent(urlPath)}&${ts}`;
  return crypto.createHmac('sha1', API_SECRET).update(raw).digest('base64');
}

async function frodoGet(endpoint, params) {
  const ts = getTS();
  const url = new URL(endpoint, FRODO_BASE);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('apiKey', API_KEY);
  url.searchParams.set('os_rom', 'android');
  const sig = sign(url.pathname, ts);
  url.searchParams.set('_ts', ts);
  url.searchParams.set('_sig', sig);
  return axios.get(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 8000,
  });
}

async function main() {
  const pool = mysql.createPool({
    host: 'localhost', user: 'libereica', password: 'L1ber1ca',
    database: 'movie_archive', waitForConnections: true, connectionLimit: 5,
  });

  const [rows] = await pool.query(
    "SELECT id, title, altTitle, doubanUrl FROM movies WHERE (poster IS NULL OR poster = '') LIMIT 450"
  );
  console.log(`需要获取海报的电影数: ${rows.length}`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const movie = rows[i];
    let posterUrl = null;

    // 如果有豆瓣链接，从链接提取ID
    let doubanId = null;
    if (movie.doubanUrl) {
      const m = movie.doubanUrl.match(/subject\/(\d+)/);
      if (m) doubanId = m[1];
    }

    try {
      // 优先使用 TMDB
      const tmdb = require('./tmdb');
      if (tmdb.isConfigured()) {
        posterUrl = await tmdb.findPosterByTitle(movie.title, movie.altTitle, movie.doubanUrl);
      }

      // 如果 TMDB 失败，尝试豆瓣网页抓取
      if (!posterUrl && doubanId) {
        const doubanScraper = require('./douban_scraper');
        posterUrl = await doubanScraper.scrapePoster(doubanId);
      }

      if (posterUrl) {
        await pool.query("UPDATE movies SET poster = ? WHERE id = ?", [posterUrl, movie.id]);
        updated++;
        console.log(`✅ [${i+1}/${rows.length}] ${movie.title} -> 海报已更新`);
      } else {
        failed++;
        console.log(`❌ [${i+1}/${rows.length}] ${movie.title} -> 未找到海报`);
      }
    } catch (e) {
      failed++;
      console.log(`❌ [${i+1}/${rows.length}] ${movie.title} -> 错误: ${e.message}`);
    }

    // 间隔一下，避免触发限流
    if (i % 10 === 9) await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n完成! 更新: ${updated}, 失败: ${failed}`);
  await pool.end();
}

main();
