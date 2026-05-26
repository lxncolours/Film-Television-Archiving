const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

const CONFIG_PATH = path.join(__dirname, '..', 'tmdb_config.json');
const POSTER_BASE = 'https://image.tmdb.org/t/p';

let config = null;
let client = null;

// Chinese season patterns: 第一季(1), 第二季(2), 第三季(3), ... 第十季(10)
const CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

function parseSeasonInfo(title) {
  if (!title) return { base: '', season: 0 };
  let season = 0;
  let base = title;

  // Pattern 1: "浴血黑帮 第一季", "权力的游戏 第三季"
  let m = title.match(/(.+?)[\s　]*第([一二三四五六七八九十]+)季$/);
  if (m) {
    base = m[1].trim();
    season = CN_NUM[m[2]] || 0;
    return { base, season };
  }

  // Pattern 2: "第1季", "第2季" at end
  m = title.match(/(.+?)[\s　]*第(\d+)季$/);
  if (m) {
    base = m[1].trim();
    season = parseInt(m[2]) || 0;
    return { base, season };
  }

  // Pattern 3: "Season 1", "Season 02"
  m = title.match(/(.+?)[\s\-_]*[Ss]eason[\s\-_]*(\d+)$/);
  if (m) {
    base = m[1].trim();
    season = parseInt(m[2]) || 0;
    return { base, season };
  }

  // Pattern 4: "S01", "S1", "s02"
  m = title.match(/(.+?)[\s\-_]*[Ss](\d+)$/);
  if (m && m[2].length <= 2) {
    base = m[1].trim();
    season = parseInt(m[2]) || 0;
    return { base, season };
  }

  return { base, season };
}

function loadConfig() {
  if (config) return config;
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    // ignore
  }
  if (!config) config = {};
  if (!config.api_key) config.api_key = process.env.TMDB_API_KEY || '';
  if (!config.proxy) {
    try {
      const url = require('url');
      if (process.env.HTTPS_PROXY) config.proxy = process.env.HTTPS_PROXY;
      else if (process.env.HTTP_PROXY) config.proxy = process.env.HTTP_PROXY;
      else config.proxy = 'http://127.0.0.1:6789';
    } catch {
      config.proxy = 'http://127.0.0.1:6789';
    }
  }
  return config;
}

function saveConfig(apiKey) {
  const cfg = loadConfig();
  cfg.api_key = apiKey;
  config = cfg;
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) {
    // ignore
  }
}

function getClient() {
  if (client) return client;

  const cfg = loadConfig();
  const options = { timeout: 15000 };

  if (cfg.proxy) {
    const parsed = new URL(cfg.proxy);
    options.proxy = {
      host: parsed.hostname,
      port: parseInt(parsed.port) || 6789,
      protocol: parsed.protocol.replace(':', ''),
    };
  }

  options.httpsAgent = new https.Agent({ rejectUnauthorized: false });

  client = axios.create(options);
  return client;
}

function getApiKey() {
  return loadConfig().api_key;
}

function isConfigured() {
  return !!getApiKey();
}

async function searchMulti(query, language = 'zh-CN') {
  const c = getClient();
  const key = getApiKey();
  if (!key) return [];

  try {
    const r = await c.get('https://api.themoviedb.org/3/search/multi', {
      params: { api_key: key, query, language, page: 1 },
    });
    return r.data.results || [];
  } catch (e) {
    if (e.response?.status === 401) {
      throw new Error('TMDB API key invalid. Please set a valid key in tmdb_config.json');
    }
    return [];
  }
}

async function getMovieDetails(tmdbId, language = 'zh-CN') {
  const c = getClient();
  const key = getApiKey();
  if (!key) return null;

  try {
    const r = await c.get(`https://api.themoviedb.org/3/movie/${tmdbId}`, {
      params: { api_key: key, language },
    });
    return r.data;
  } catch (e) {
    logger.error('Failed to fetch movie details:', e.message);
    return null;
  }
}

async function getTvDetails(tmdbId, language = 'zh-CN') {
  const c = getClient();
  const key = getApiKey();
  if (!key) return null;

  try {
    const r = await c.get(`https://api.themoviedb.org/3/tv/${tmdbId}`, {
      params: { api_key: key, language },
    });
    return r.data;
  } catch (e) {
    logger.error('Failed to fetch TV details:', e.message);
    return null;
  }
}

async function getSeasonDetails(tmdbId, seasonNumber, language = 'zh-CN') {
  const c = getClient();
  const key = getApiKey();
  if (!key) return null;

  try {
    const r = await c.get(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}`, {
      params: { api_key: key, language },
    });
    return r.data;
  } catch (e) {
    logger.error('Failed to fetch season details:', e.message);
    return null;
  }
}

function getPosterUrl(posterPath, size = 'w500') {
  if (!posterPath) return null;
  return `${POSTER_BASE}/${size}${posterPath}`;
}

function titleMatches(title, result) {
  const names = [result.title, result.name, result.original_title, result.original_name].filter(Boolean);
  return names.some(n => n === title);
}

async function findPoster(title, altTitle, type) {
  const c = getClient();
  const key = getApiKey();
  if (!key) return null;

  // Parse season info from title
  const seasonInfo = parseSeasonInfo(title);
  const hasSeason = seasonInfo.season > 0;

  // Search queries: try altTitle first, then base name (stripped of season), then full title
  const queries = [];
  if (altTitle) queries.push(altTitle);
  if (hasSeason && seasonInfo.base) queries.push(seasonInfo.base);
  queries.push(title);

  let allResults = [];
  for (const q of queries) {
    if (!q || allResults.length > 0) continue;
    const results = await searchMulti(q);
    allResults = results;
    if (results.length === 0) continue;
  }

  const targetType = (type === '剧集' || type === '纪录片') ? 'tv' : 'movie';

  // Build match candidates: prefer exact base name match, then first result
  let bestMatch = null;

  for (const r of allResults) {
    if (r.media_type !== targetType && r.media_type !== 'movie' && r.media_type !== 'tv') continue;
    if (r.media_type !== targetType && targetType === 'tv' && r.media_type === 'movie') continue;
    if (r.media_type !== targetType && targetType === 'movie' && r.media_type === 'tv') continue;

    const isExact = titleMatches(title, r) || titleMatches(altTitle, r) ||
      (hasSeason && seasonInfo.base && titleMatches(seasonInfo.base, r));
    if (isExact) {
      bestMatch = r;
      break;
    }
    if (!bestMatch) bestMatch = r;
  }

  if (!bestMatch) return null;

  let posterPath = bestMatch.poster_path;

  // If this is a TV series with a season number, try to get the season-specific poster
  if (hasSeason && (targetType === 'tv' || bestMatch.media_type === 'tv')) {
    try {
      const seasonData = await getSeasonDetails(bestMatch.id, seasonInfo.season);
      if (seasonData && seasonData.poster_path) {
        posterPath = seasonData.poster_path;
      } else if (!posterPath) {
        // Fallback: get series details for poster
        const detail = await getTvDetails(bestMatch.id);
        if (detail) posterPath = detail.poster_path;
      }
    } catch {
      // ignore
    }
  } else if (!posterPath && bestMatch.id) {
    // No season info, try detail endpoint
    try {
      if (targetType === 'movie' || bestMatch.media_type === 'movie') {
        const detail = await getMovieDetails(bestMatch.id);
        if (detail) posterPath = detail.poster_path;
      } else {
        const detail = await getTvDetails(bestMatch.id);
        if (detail) posterPath = detail.poster_path;
      }
    } catch {
      // ignore
    }
  }

  if (!posterPath) return null;

  for (const size of ['original', 'w780', 'w500']) {
    const url = getPosterUrl(posterPath, size);
    if (url) return url;
  }
  return getPosterUrl(posterPath);
}

async function findPosterByTitle(title, altTitle, tmdbUrl, mediaType) {
  return await findPoster(title, altTitle, mediaType);
}


module.exports = {
  isConfigured,
  getApiKey,
  saveConfig,
  searchMulti,
  findPoster,
  findPosterByTitle,
  getPosterUrl,
  getMovieDetails,
  getTvDetails,
  getSeasonDetails,
  parseSeasonInfo,
};
