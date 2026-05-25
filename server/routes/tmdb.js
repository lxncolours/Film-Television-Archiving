const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const tmdb = require('../tmdb');

const CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

function parseSeason(title) {
  if (!title) return { base: '', season: 0 };
  let m = title.match(/(.+?)[\s　]*第([一二三四五六七八九十]+)季$/);
  if (m) return { base: m[1].trim(), season: CN_NUM[m[2]] || 0 };
  m = title.match(/(.+?)[\s　]*第(\d+)季$/);
  if (m) return { base: m[1].trim(), season: parseInt(m[2]) || 0 };
  m = title.match(/(.+?)[\s\-_]*[Ss]eason[\s\-_]*(\d+)$/);
  if (m) return { base: m[1].trim(), season: parseInt(m[2]) || 0 };
  return { base: '', season: 0 };
}

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

// Use proxy matching the system configuration (required for network access)
const tmdbClient = axios.create({
  timeout: 15000,
  proxy: { host: '127.0.0.1', port: 6789, protocol: 'http' },
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
});

function tmdbGet(path) {
  const API_KEY = tmdb.getApiKey();
  if (!API_KEY) return Promise.reject(new Error('API Key not configured'));
  return tmdbClient.get(`https://api.themoviedb.org/3${path}&api_key=${API_KEY}`).then(r => r.data);
}

router.get('/config', (req, res) => {
  res.json({
    success: true,
    data: {
      configured: tmdb.isConfigured(),
      api_key_set: !!tmdb.getApiKey(),
    },
  });
});

router.post('/config', (req, res) => {
  const { api_key } = req.body;
  if (!api_key) {
    return res.status(400).json({ success: false, message: '请提供 API Key' });
  }
  tmdb.saveConfig(api_key);
  res.json({ success: true, message: 'TMDB API Key 已保存' });
});

router.post('/detail', async (req, res) => {
  try {
    const { title, tmdb_id, media_type } = req.body;
    if (!title && !tmdb_id) {
      return res.status(400).json({ success: false, message: '请提供片名或 TMDB ID' });
    }

    const API_KEY = tmdb.getApiKey();
    if (!API_KEY) {
      return res.status(400).json({ success: false, message: 'TMDB API Key 未配置' });
    }

    const si = parseSeason(title || '');

    // If tmdb_id is provided, fetch directly by ID
    if (tmdb_id && media_type) {
      let detail;
      try {
        detail = await tmdbGet(`/${media_type}/${tmdb_id}?language=zh-CN`);
      } catch { /* fallback to search */ }
      if (detail) {
        let posterPath = detail.poster_path;
        let seasonYear = null;

        // If this is a TV series with a season number from title, try to get season-specific info
        if (media_type === 'tv' && si.season > 0) {
          try {
            const sd = await tmdbGet(`/tv/${tmdb_id}/season/${si.season}?language=zh-CN`);
            if (sd) {
              if (sd.poster_path) posterPath = sd.poster_path;
              if (sd.air_date) seasonYear = parseInt(sd.air_date.slice(0, 4));
            }
          } catch { /* fallback */ }
        }

        const posterUrl = posterPath ? `https://image.tmdb.org/t/p/original${posterPath}` : '';
        const year = seasonYear || (detail.release_date ? parseInt(detail.release_date.slice(0, 4)) : (detail.first_air_date ? parseInt(detail.first_air_date.slice(0, 4)) : 0));
        const countries = detail.production_countries ? detail.production_countries.map(c => c.name).join(' / ') : (detail.origin_country ? detail.origin_country.join(' / ') : '');
        const countries_cn = translateCountries(countries);
        const genres = detail.genres ? detail.genres.map(g => g.name) : [];
        const seriesTitle = detail.title || detail.name || '';
        const titleEn = detail.original_title || detail.original_name || '';
        const tmdbRating = detail.vote_average ? Math.round(detail.vote_average) : 0;

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

    let searchData;
    try {
      searchData = await tmdbGet(`/search/multi?query=${encodeURIComponent(searchQ)}&language=zh-CN&page=1`);
    } catch (e) {
      return res.status(502).json({ success: false, message: 'TMDB 请求失败: ' + e.message });
    }
    const results = searchData.results || [];
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

    const isTv = best.media_type === 'tv';

    let detail;
    try {
      detail = await tmdbGet(`/${isTv ? 'tv' : 'movie'}/${best.id}?language=zh-CN`);
    } catch { /* use search result */ }

    const d = detail || best;
    let posterPath = d.poster_path;
    let seasonYear = null;

    if (isTv && si.season > 0) {
      try {
        const sd = await tmdbGet(`/tv/${best.id}/season/${si.season}?language=zh-CN`);
        if (sd) {
          if (sd.poster_path) posterPath = sd.poster_path;
          if (sd.air_date) seasonYear = parseInt(sd.air_date.slice(0, 4));
        }
      } catch { /* fallback */ }
    }

    const posterUrl = posterPath ? `https://image.tmdb.org/t/p/original${posterPath}` : '';
    const year = seasonYear || (d.release_date ? parseInt(d.release_date.slice(0, 4)) : (d.first_air_date ? parseInt(d.first_air_date.slice(0, 4)) : 0));
    const countries = d.production_countries ? d.production_countries.map(c => c.name).join(' / ') : (d.origin_country ? d.origin_country.join(' / ') : '');
    const countries_cn = translateCountries(countries);
    const genres = d.genres ? d.genres.map(g => g.name) : [];
    const seriesTitle = d.title || d.name || '';
    const titleEn = d.original_title || d.original_name || '';
    const tmdbRating = d.vote_average ? Math.round(d.vote_average) : 0;

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
    console.error('TMDB详情获取失败:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
