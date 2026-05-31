const express = require('express');
const router = express.Router();
const tmdb = require('../tmdb');
const logger = require('../utils/logger');

const COUNTRY_CN = {
  'United States': '美国',
  'United States of America': '美国',
  'USA': '美国',
  'Canada': '加拿大',
  'United Kingdom': '英国',
  'UK': '英国',
  'Great Britain': '英国',
  'France': '法国',
  'Germany': '德国',
  'Japan': '日本',
  'Japan(Japan)': '日本',
  'South Korea': '韩国',
  'Korea': '韩国',
  'China': '中国大陆',
  'Hong Kong': '香港',
  'Taiwan': '台湾',
  'India': '印度',
  'Australia': '澳大利亚',
  'New Zealand': '新西兰',
  'Russia': '俄罗斯',
  'Spain': '西班牙',
  'Italy': '意大利',
  'Netherlands': '荷兰',
  'Belgium': '比利时',
  'Sweden': '瑞典',
  'Norway': '挪威',
  'Denmark': '丹麦',
  'Finland': '芬兰',
  'Poland': '波兰',
  'Turkey': '土耳其',
  'Thailand': '泰国',
  'Vietnam': '越南',
  'Singapore': '新加坡',
  'Malaysia': '马来西亚',
  'Indonesia': '印度尼西亚',
  'Philippines': '菲律宾',
  'Brazil': '巴西',
  'Mexico': '墨西哥',
  'Argentina': '阿根廷',
  'South Africa': '南非',
  'Egypt': '埃及',
  'Nigeria': '尼日利亚',
  'Ireland': '爱尔兰',
  'Iceland': '冰岛',
  'Austria': '奥地利',
  'Switzerland': '瑞士',
  'Portugal': '葡萄牙',
  'Greece': '希腊',
  'Czech Republic': '捷克',
  'Hungary': '匈牙利',
  'Romania': '罗马尼亚',
  'Israel': '以色列',
  'Saudi Arabia': '沙特阿拉伯',
  'United Arab Emirates': '阿联酋',
  'Cuba': '古巴',
  'Colombia': '哥伦比亚',
  'Chile': '智利',
  'Peru': '秘鲁',
};

function translateCountry(en) {
  return COUNTRY_CN[en] || en;
}

function translateCountries(str) {
  if (!str) return '';
  return str.split(' / ').map(c => translateCountry(c.trim())).join(' / ');
}

function extractYear(seasonYear, detail) {
  if (seasonYear) return seasonYear;
  if (detail.release_date) return parseInt(detail.release_date.slice(0, 4));
  if (detail.first_air_date) return parseInt(detail.first_air_date.slice(0, 4));
  return 0;
}

function extractCountries(detail) {
  if (detail.production_countries) {
    return detail.production_countries.map(c => c.name).join(' / ');
  } else if (detail.origin_country) {
    return detail.origin_country.join(' / ');
  }
  return '';
}

function extractTitleInfo(detail) {
  const seriesTitle = detail.title || detail.name || '';
  const titleEn = detail.original_title || detail.original_name || '';
  const tmdbRating = detail.vote_average ? Math.round(detail.vote_average) : 0;
  return { seriesTitle, titleEn, tmdbRating };
}

router.get('/config', async (req, res) => {
  const configured = await tmdb.isConfigured();
  const api_key_set = !!(await tmdb.getApiKey());
  logger.info(`[TMDB Route] GET /config - configured: ${configured}, api_key_set: ${api_key_set}`);
  res.json({
    success: true,
    data: {
      configured,
      api_key_set,
    },
  });
});

router.post('/config', async (req, res) => {
  const { api_key } = req.body;
  if (!api_key) {
    return res.status(400).json({ success: false, message: '请提供 API Key' });
  }
  logger.info(`[TMDB Route] POST /config - api_key length: ${api_key.length}`);
  try {
    await tmdb.saveConfig(api_key);
    logger.info('[TMDB Route] saveConfig succeeded, sending success response');
    res.json({ success: true, message: 'TMDB API Key 已保存' });
  } catch (e) {
    logger.error(`[TMDB Route] saveConfig failed: ${e.message}`);
    logger.error(`[TMDB Route] Stack: ${e.stack}`);
    res.status(500).json({ success: false, message: '保存失败: ' + e.message });
  }
});

router.post('/detail', async (req, res) => {
  try {
    const { title, tmdb_id, media_type } = req.body;
    logger.info(`[TMDB Route] POST /detail - title: "${title}", tmdb_id: ${tmdb_id}, media_type: ${media_type}`);
    if (!title && !tmdb_id) {
      return res.status(400).json({ success: false, message: '请提供片名或 TMDB ID' });
    }

    const API_KEY = await tmdb.getApiKey();
    if (!API_KEY) {
      return res.status(400).json({ success: false, message: 'TMDB API Key 未配置' });
    }

    const si = tmdb.parseSeasonInfo(title || '');
    logger.debug('Parsed season info:', si);

    if (tmdb_id && media_type) {
      let detail;
      try {
        logger.info(`[TMDB Route] POST /detail - 通过ID获取详情: tmdb_id=${tmdb_id}, media_type=${media_type}`);
        detail = media_type === 'tv' ? await tmdb.getTvDetails(tmdb_id) : await tmdb.getMovieDetails(tmdb_id);
      } catch (e) { 
        logger.error(`[TMDB Route] POST /detail - 通过ID获取详情失败: ${e.message}`);
      }
      if (detail) {
        let posterPath = detail.poster_path;
        let seasonYear = null;

        if (media_type === 'tv' && si.season > 0) {
          try {
            logger.debug(`Fetching season ${si.season} for TV ${tmdb_id}`);
            const sd = await tmdb.getSeasonDetails(tmdb_id, si.season);
            if (sd) {
              if (sd.poster_path) posterPath = sd.poster_path;
              if (sd.air_date) seasonYear = parseInt(sd.air_date.slice(0, 4));
              else if (sd.episodes && sd.episodes.length > 0 && sd.episodes[0].air_date) {
                seasonYear = parseInt(sd.episodes[0].air_date.slice(0, 4));
              }
              logger.debug('Season year:', seasonYear);
            }
          } catch (e) { 
            logger.error(`[TMDB Route] POST /detail - 获取季详情失败: ${e.message}`);
          }
        }

        const posterUrl = posterPath ? `https://image.tmdb.org/t/p/original${posterPath}` : '';
        const year = extractYear(seasonYear, detail);
        const countries = extractCountries(detail);
        const countries_cn = translateCountries(countries);
        const genres = detail.genres ? detail.genres.map(g => g.name) : [];
        const { seriesTitle, titleEn, tmdbRating } = extractTitleInfo(detail);

        const tmdbUrl = `https://www.themoviedb.org/${media_type}/${tmdb_id}`;
        
        return res.json({
          success: true,
          data: {
            seriesTitle,
            altTitle: (titleEn !== seriesTitle) ? titleEn : '',
            year: isNaN(year) ? 0 : year,
            countries: countries_cn,
            genres,
            poster: posterUrl,
            rating: tmdbRating,
            tmdbUrl,
          },
        });
      }
    }

    const searchQ = si.season > 0 && si.base ? si.base : title;
    logger.debug('Search query:', searchQ, 'Season:', si.season);

    let results;
    try {
      logger.info(`[TMDB Route] POST /detail - TMDB搜索: "${searchQ}"`);
      results = await tmdb.searchMulti(searchQ);
      logger.info(`[TMDB Route] POST /detail - 搜索结果数: ${results.length}`);
    } catch (e) {
      logger.error(`[TMDB Route] POST /detail - 搜索失败: ${e.message}`);
      return res.status(502).json({ success: false, message: 'TMDB 请求失败: ' + e.message });
    }
    if (results.length === 0) {
      return res.json({ success: false, message: 'TMDB 未找到该影片' });
    }

    let best = null;
    for (const r of results) {
      if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
      if (si.season > 0 && r.media_type === 'movie') continue;
      const names = [r.title, r.name, r.original_title, r.original_name].filter(Boolean);
      if (names.some(n => n === searchQ)) { best = r; break; }
      if (!best) best = r;
    }
    if (!best) {
      return res.json({ success: false, message: 'TMDB 未找到该影片' });
    }

    logger.debug('Best match:', best.name || best.title, best.id, best.media_type);
    const isTv = best.media_type === 'tv';

    let detail;
    try {
      logger.info(`[TMDB Route] POST /detail - 获取最佳匹配详情: id=${best.id}, media_type=${best.media_type}`);
      detail = isTv ? await tmdb.getTvDetails(best.id) : await tmdb.getMovieDetails(best.id);
    } catch (e) { 
      logger.error(`[TMDB Route] POST /detail - 获取详情失败: ${e.message}`);
    }

    const d = detail || best;
    let posterPath = d.poster_path;
    let seasonYear = null;

    if (isTv && si.season > 0) {
      try {
        logger.debug(`Fetching season ${si.season} for TV ${best.id}`);
        const sd = await tmdb.getSeasonDetails(best.id, si.season);
        if (sd) {
          if (sd.poster_path) posterPath = sd.poster_path;
          if (sd.air_date) seasonYear = parseInt(sd.air_date.slice(0, 4));
          else if (sd.episodes && sd.episodes.length > 0 && sd.episodes[0].air_date) {
            seasonYear = parseInt(sd.episodes[0].air_date.slice(0, 4));
          }
          logger.debug('Season year from API:', seasonYear);
        }
      } catch (e) { 
        logger.error(`[TMDB Route] POST /detail - 获取季详情失败: ${e.message}`);
      }
    }

    const posterUrl = posterPath ? `https://image.tmdb.org/t/p/original${posterPath}` : '';
    const year = extractYear(seasonYear, d);
    const countries = extractCountries(d);
    const countries_cn = translateCountries(countries);
    const genres = d.genres ? d.genres.map(g => g.name) : [];
    const { seriesTitle, titleEn, tmdbRating } = extractTitleInfo(d);

    const tmdbUrl = `https://www.themoviedb.org/${best.media_type}/${best.id}`;

    res.json({
      success: true,
      data: {
        seriesTitle,
        altTitle: (titleEn !== seriesTitle) ? titleEn : '',
        year: isNaN(year) ? 0 : year,
        countries: countries_cn,
        genres,
        poster: posterUrl,
        rating: tmdbRating,
        tmdbUrl,
      },
    });
  } catch (err) {
    logger.error(`[TMDB Route] POST /detail - 获取详情失败: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
