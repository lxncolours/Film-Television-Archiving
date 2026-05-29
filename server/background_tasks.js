const tmdb = require('./tmdb');
const dbPool = require('./db');
const proxyConfig = require('./proxy-config');
const logger = require('./utils/logger');

const CONFIG = {
  intervalMs: 30000,
};

const proxyAxios = proxyConfig.createAxiosInstance();

let taskRunning = false;
let taskInterval = null;
let stats = { processed: 0, success: 0, failed: 0, lastRun: null };

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchOnePoster() {
  const [rows] = await dbPool.query(
    "SELECT id, title, altTitle, tmdbUrl, type FROM movies WHERE (poster_data IS NULL OR poster_data = '') AND (poster IS NULL OR poster = '' OR poster = '_not_found_') ORDER BY tmdbUrl DESC, id ASC LIMIT 1"
  );

  if (rows.length === 0) {
    return false;
  }

  const movie = rows[0];

  let posterUrl = null;

  try {
    if (!posterUrl && tmdb.isConfigured()) {
      try {
        posterUrl = await tmdb.findPosterByTitle(movie.title, movie.altTitle, movie.tmdbUrl, movie.type);
      } catch (e) {
        logger.warn('TMDB查询海报失败:', movie.title, e.message);
      }
    }

    if (!posterUrl) {
      await dbPool.query("UPDATE movies SET poster = '_not_found_' WHERE id = ?", [movie.id]);
      logger.warn('未找到海报，已标记跳过:', movie.title);
      stats.failed++;
      stats.processed++;
      stats.lastRun = new Date();
      return true;
    }

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
      logger.warn('图片下载失败:', movie.title, e.message);
    }

    if (imageData) {
      await dbPool.query(
        'UPDATE movies SET poster = ?, poster_data = ?, poster_mime = ? WHERE id = ?',
        [posterUrl, imageData, imageMime, movie.id]
      );
    } else {
      await dbPool.query('UPDATE movies SET poster = ? WHERE id = ?', [posterUrl, movie.id]);
    }

    stats.success++;
    stats.processed++;
    stats.lastRun = new Date();
    return true;

  } catch (err) {
    logger.error('海报获取异常:', movie.title, err.message);
    stats.failed++;
    stats.lastRun = new Date();
    return false;
  }
}

async function runTask() {
  if (taskRunning) return;

  taskRunning = true;
  try {
    await fetchOnePoster();
  } catch (err) {
    logger.error('后台任务异常:', err);
  } finally {
    taskRunning = false;
  }
}

function start() {
  if (taskInterval) return;

  logger.info(`启动后台海报任务，每 ${CONFIG.intervalMs / 1000} 秒处理一部`);
  
  runTask();
  taskInterval = setInterval(runTask, CONFIG.intervalMs);
}

function stop() {
  if (taskInterval) {
    clearInterval(taskInterval);
    taskInterval = null;
    logger.info('后台海报任务已停止');
  }
}

function getStats() {
  return { ...stats, running: !!taskInterval, interval: CONFIG.intervalMs };
}

module.exports = { start, stop, getStats };
