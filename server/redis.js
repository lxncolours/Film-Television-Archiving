const redis = require('redis');
const logger = require('./utils/logger');

const CACHE_TTL = 300;
let client = null;

async function getClient() {
  if (!client) {
    client = redis.createClient({
      disableOfflineQueue: true,
      socket: { host: process.env.REDIS_HOST || '127.0.0.1', port: parseInt(process.env.REDIS_PORT) || 6379, reconnectStrategy: false }
    });
    client.on('error', (err) => { logger.debug('Redis client error:', err.message); client = null; });
    try {
      await client.connect();
    } catch (e) {
      logger.debug('Redis connection failed:', e.message);
      client = null;
      return null;
    }
  }
  return client;
}

function makeKey(path, params) {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  return 'movies:' + path + '?' + sorted;
}

async function scanKeys(pattern) {
  const c = await getClient();
  if (!c) return [];
  const keys = [];
  let cursor = 0;
  try {
    do {
      const result = await c.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = result.cursor;
      keys.push(...result.keys);
    } while (cursor !== 0);
  } catch (e) {
    logger.debug('Redis SCAN error:', e.message);
  }
  return keys;
}

async function get(key) {
  try {
    const c = await getClient();
    if (!c) return null;
    const raw = await c.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    logger.debug('Redis get error:', e.message);
    return null;
  }
}

async function set(key, data, ttl = CACHE_TTL) {
  try {
    const c = await getClient();
    if (!c) return;
    await c.setEx(key, ttl, JSON.stringify(data));
  } catch (e) {
    logger.debug('Redis set error:', e.message);
  }
}

async function del(pattern) {
  try {
    const keys = await scanKeys(pattern);
    if (keys.length > 0) {
      const c = await getClient();
      if (c) await c.del(keys);
    }
  } catch (e) {
    logger.debug('Redis del error:', e.message);
  }
}

async function flushMovies() {
  await del('movies:*');
}

async function updateMovieInCache(movieId, updatedData) {
  try {
    const c = await getClient();
    if (!c) return;
    
    const keys = await scanKeys('movies:list*');
    for (const key of keys) {
      const raw = await c.get(key);
      if (!raw) continue;
      try {
        const cachedData = JSON.parse(raw);
        if (cachedData.data && Array.isArray(cachedData.data)) {
          const movieIndex = cachedData.data.findIndex(m => String(m.id) === String(movieId));
          if (movieIndex !== -1) {
            cachedData.data[movieIndex] = {
              ...cachedData.data[movieIndex],
              ...updatedData
            };
            await c.setEx(key, CACHE_TTL, JSON.stringify(cachedData));
          }
        }
      } catch (e) {
        logger.debug('Redis updateMovieInCache parse error:', e.message);
      }
    }
  } catch (e) {
    logger.debug('Redis updateMovieInCache error:', e.message);
  }
}

module.exports = { get, set, del, flushMovies, makeKey, updateMovieInCache };
