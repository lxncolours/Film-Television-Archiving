/**
 * 海报文件存储模块
 *
 * 设计：
 * - 海报二进制不再存 MySQL BLOB（poster_data），改存本地文件系统 data/posters/
 * - 文件名 = 内容 sha1 + 扩展名（如 3a5f...c2.jpg），天然去重、内容寻址：
 *   导入导出不依赖数据库 id，同一张海报多部电影引用也只存一份
 * - 数据库仅存 poster_file VARCHAR(64) 文件名
 * - 旧数据 poster_data 保留兼容读取（migrate-posters.js 会逐步迁移清空）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const POSTER_DIR = path.join(__dirname, '..', '..', 'data', 'posters');

// mime -> 扩展名
const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};
const EXT_MIME = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]));

const VALID_NAME_RE = /^[0-9a-f]{40}\.(jpg|png|webp|gif|avif)$/;

function ensureDir() {
  fs.mkdirSync(POSTER_DIR, { recursive: true });
}

function extOf(mime) {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  return MIME_EXT[m] || 'jpg';
}

function mimeOf(fileName) {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  return EXT_MIME[ext] || 'image/jpeg';
}

/** 安全校验：文件名必须是合法的 hash.ext 格式，防止路径穿越 */
function isValidName(fileName) {
  return typeof fileName === 'string' && VALID_NAME_RE.test(fileName);
}

function absPath(fileName) {
  return path.join(POSTER_DIR, fileName);
}

/**
 * 保存海报 buffer，返回 poster_file 文件名（sha1.ext）。
 * 幂等：同名文件（即同内容）已存在时跳过写入。
 */
function savePoster(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  const hash = crypto.createHash('sha1').update(buffer).digest('hex');
  const fileName = `${hash}.${extOf(mime)}`;
  ensureDir();
  const p = absPath(fileName);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, buffer);
  }
  return fileName;
}

/** 读取海报文件，不存在返回 null */
function readPoster(fileName) {
  if (!isValidName(fileName)) return null;
  try {
    return fs.readFileSync(absPath(fileName));
  } catch {
    return null;
  }
}

function posterExists(fileName) {
  return isValidName(fileName) && fs.existsSync(absPath(fileName));
}

/**
 * 删除不再被任何电影引用的海报文件（hash 命名可能被多条记录共享，需查引用计数）。
 * 仅在删除电影/更换海报时调用，频率低，全表 COUNT 可接受。
 */
async function removePosterIfUnshared(pool, fileName) {
  if (!isValidName(fileName)) return;
  try {
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM movies WHERE poster_file = ?', [fileName]);
    if (rows[0].n === 0) {
      fs.unlinkSync(absPath(fileName));
      return true;
    }
  } catch (e) {
    console.warn(`[posterStore] remove check failed for ${fileName}: ${e.message}`);
  }
  return false;
}

/** data/posters 目录（导出 zip 时用） */
function posterDir() {
  return POSTER_DIR;
}

module.exports = { savePoster, readPoster, posterExists, removePosterIfUnshared, isValidName, mimeOf, posterDir, ensureDir };
