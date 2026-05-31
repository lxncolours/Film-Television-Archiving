const logger = require('./utils/logger');
const proxyConfig = require('./proxy-config');

const POSTER_BASE = 'https://image.tmdb.org/t/p';

let config = null;
let client = null;

const CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

function parseSeasonInfo(title) {
  if (!title) return { base: '', season: 0 };
  let season = 0;
  let base = title;

  let m = title.match(/(.+?)[\s　]*第([一二三四五六七八九十]+)季$/);
  if (m) {
    base = m[1].trim();
    season = CN_NUM[m[2]] || 0;
    return { base, season };
  }

  m = title.match(/(.+?)[\s　]*第(\d+)季$/);
  if (m) {
    base = m[1].trim();
    season = parseInt(m[2]) || 0;
    return { base, season };
  }

  m = title.match(/(.+?)[\s\-_]*[Ss]eason[\s\-_]*(\d+)$/);
  if (m) {
    base = m[1].trim();
    season = parseInt(m[2]) || 0;
    return { base, season };
  }

  m = title.match(/(.+?)[\s\-_]*[Ss](\d+)$/);
  if (m && m[2].length <= 2) {
    base = m[1].trim();
    season = parseInt(m[2]) || 0;
    return { base, season };
  }

  return { base, season };
}

async function init() {
  try {
    const { getSetting, SETTING_KEYS } = require('./utils/settings');
    const dbKey = await getSetting(SETTING_KEYS.TMDB_API_KEY);
    if (dbKey) {
      config = { api_key: dbKey };
    }
  } catch (e) {
    logger.debug('TMDB init from DB failed:', e.message);
  }
}

async function saveConfig(apiKey) {
  logger.info(`[TMDB] saveConfig called with key length: ${apiKey ? apiKey.length : 0}`);
  config = { api_key: apiKey };
  const { setSetting, SETTING_KEYS } = require('./utils/settings');
  logger.info(`[TMDB] Calling setSetting with key: ${SETTING_KEYS.TMDB_API_KEY}`);
  const success = await setSetting(SETTING_KEYS.TMDB_API_KEY, apiKey);
  logger.info(`[TMDB] setSetting returned: ${success}`);
  if (!success) {
    logger.error('[TMDB] setSetting returned false, throwing error');
    throw new Error('Failed to save TMDB API Key to database');
  }
  logger.info('[TMDB] saveConfig completed successfully');
}

function getClient() {
  if (client) return client;
  client = proxyConfig.createAxiosInstance({ timeout: 15000 });
  return client;
}

async function getApiKey() {
  if (config) return config.api_key;
  try {
    const { getSetting, SETTING_KEYS } = require('./utils/settings');
    const dbKey = await getSetting(SETTING_KEYS.TMDB_API_KEY);
    if (dbKey) {
      config = { api_key: dbKey };
      return dbKey;
    }
  } catch (e) {
    logger.debug('getApiKey DB fallback failed:', e.message);
  }
  return '';
}

async function isConfigured() {
  return !!(await getApiKey());
}

async function searchMulti(query, language = 'zh-CN') {
  const c = getClient();
  const key = await getApiKey();
  if (!key) return [];

  try {
    const r = await c.get('https://api.themoviedb.org/3/search/multi', {
      params: { api_key: key, query, language, page: 1 },
    });
    return r.data.results || [];
  } catch (e) {
    if (e.response?.status === 401) {
      throw new Error('TMDB API key invalid. Please set a valid key');
    }
    return [];
  }
}

async function getMovieDetails(tmdbId, language = 'zh-CN') {
  const c = getClient();
  const key = await getApiKey();
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
  const key = await getApiKey();
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
  const key = await getApiKey();
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
  const key = await getApiKey();
  if (!key) return null;

  const seasonInfo = parseSeasonInfo(title);
  const hasSeason = seasonInfo.season > 0;

  const queries = [];
  if (altTitle) queries.push(altTitle);
  if (hasSeason && seasonInfo.base) queries.push(seasonInfo.base);
  queries.push(title);

  let allResults = [];
  for (const q of queries) {
    if (!q || allResults.length > 0) continue;
    const results = await searchMulti(q);
    allResults = results;
  }

  const targetType = (type === '剧集' || type === '纪录片') ? 'tv' : 'movie';

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

  if (hasSeason && (targetType === 'tv' || bestMatch.media_type === 'tv')) {
    try {
      const seasonData = await getSeasonDetails(bestMatch.id, seasonInfo.season);
      if (seasonData && seasonData.poster_path) {
        posterPath = seasonData.poster_path;
      } else if (!posterPath) {
        const detail = await getTvDetails(bestMatch.id);
        if (detail) posterPath = detail.poster_path;
      }
    } catch {
      // ignore
    }
  } else if (!posterPath && bestMatch.id) {
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
  init
};
