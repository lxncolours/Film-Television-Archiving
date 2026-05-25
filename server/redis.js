const redis = require('redis');

const CACHE_TTL = 300;
let client = null;

async function getClient() {
  if (!client) {
    client = redis.createClient({
      socket: { host: '127.0.0.1', port: 6379, reconnectStrategy: false }
    });
    client.on('error', () => { client = null; });
    try {
      await client.connect();
    } catch (e) {
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

async function get(key) {
  try {
    const c = await getClient();
    if (!c) return null;
    const raw = await c.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function set(key, data, ttl = CACHE_TTL) {
  try {
    const c = await getClient();
    if (!c) return;
    await c.setEx(key, ttl, JSON.stringify(data));
  } catch {
    // ignore
  }
}

async function del(pattern) {
  try {
    const c = await getClient();
    if (!c) return;
    const keys = await c.keys(pattern);
    if (keys.length > 0) {
      await c.del(keys);
    }
  } catch {
    // ignore
  }
}

async function flushMovies() {
  await del('movies:*');
}

async function updateMovieInCache(movieId, updatedData) {
  try {
    const c = await getClient();
    if (!c) return;
    
    // Find all cached lists and update the movie if it exists
    const keys = await c.keys('movies:list*');
    for (const key of keys) {
      const raw = await c.get(key);
      if (!raw) continue;
      try {
        const cachedData = JSON.parse(raw);
        if (cachedData.data && Array.isArray(cachedData.data)) {
          const movieIndex = cachedData.data.findIndex(m => String(m.id) === String(movieId));
          if (movieIndex !== -1) {
            // Update only the poster-related fields
            cachedData.data[movieIndex] = {
              ...cachedData.data[movieIndex],
              ...updatedData
            };
            await c.setEx(key, CACHE_TTL, JSON.stringify(cachedData));
          }
        }
      } catch {
        // Ignore parsing errors
      }
    }
  } catch {
    // ignore
  }
}

module.exports = { get, set, del, flushMovies, makeKey, updateMovieInCache };
