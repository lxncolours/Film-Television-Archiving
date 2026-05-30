const pool = require('../db');
const cache = require('../redis');
const { encrypt, decrypt } = require('./crypto');
const logger = require('./logger');

const SETTING_KEYS = {
  TMDB_API_KEY: 'tmdb_api_key',
  PROXY_CONFIG: 'proxy_config'
};

const CACHE_TTL = 86400;

function cacheKey(key) {
  return 'settings:' + key;
}

async function getSetting(key) {
  const ck = cacheKey(key);
  try {
    const cached = await cache.get(ck);
    if (cached !== null) return cached;
  } catch (e) {
    logger.debug('Settings cache get error:', e.message);
  }

  try {
    const [rows] = await pool.query('SELECT value FROM settings WHERE `key` = ?', [key]);
    if (rows.length === 0) return null;
    const decrypted = decrypt(rows[0].value);
    if (decrypted !== null) {
      cache.set(ck, decrypted, CACHE_TTL).catch(() => {});
    }
    return decrypted;
  } catch (e) {
    logger.debug('Settings db get error:', e.message);
    return null;
  }
}

async function setSetting(key, value) {
  try {
    const encrypted = encrypt(value);
    await pool.query(
      'INSERT INTO settings (`key`, `value`, updatedAt) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE `value` = ?, updatedAt = NOW()',
      [key, encrypted, encrypted]
    );
    cache.set(cacheKey(key), value, CACHE_TTL).catch(() => {});
    return true;
  } catch (e) {
    logger.debug('Settings set error:', e.message);
    return false;
  }
}

module.exports = { getSetting, setSetting, SETTING_KEYS };
