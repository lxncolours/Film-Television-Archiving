const express = require('express');
const router = express.Router();
const pool = require('../db');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const cache = require('../redis');

const PROXY = { host: '127.0.0.1', port: 6789 };
const AGENT = new https.Agent({ rejectUnauthorized: false });

const proxyAxios = axios.create({
  proxy: PROXY,
  httpsAgent: AGENT,
  timeout: 15000,
});

const API_KEY = '0dad551ec0f84ed02907ff5c42e8ec70';
const API_SECRET = 'bf7dddc7c9cfe6f7';
const UAS = [
  'api-client/1 com.douban.frodo/7.22.0.beta9(231) Android/23 product/Mate 40 vendor/HUAWEI model/Mate 40 brand/HUAWEI rom/android network/wifi platform/AndroidPad',
  'api-client/1 com.douban.frodo/7.18.0(230) Android/22 product/MI 9 vendor/Xiaomi model/MI 9 brand/Android rom/miui6 network/wifi platform/mobile nd/1',
];

function makeSig(path, ts) {
  return crypto.createHmac('sha1', API_SECRET)
    .update('GET&' + encodeURIComponent(path) + '&' + ts)
    .digest('base64');
}

function randomUA() {
  return UAS[Math.floor(Math.random() * UAS.length)];
}

function parseRow(row) {
  const { poster_data, poster_mime, ...rest } = row;
  return {
    ...rest,
    has_poster_data: !!poster_data,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || [])
  };
}

function parseArrayParam(param) {
  if (!param) return [];
  if (Array.isArray(param)) return param.filter(Boolean);
  if (typeof param === 'string') {
    return param.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

router.get('/', async (req, res) => {
  try {
    const { search, type, year, platform, country, sort, order, page = 1, per_page = 20 } = req.query;
    
    const typeList = parseArrayParam(type);
    const yearList = parseArrayParam(year);
    const platformList = parseArrayParam(platform);
    const countryList = parseArrayParam(country);
    
    const cacheKey = cache.makeKey('list', { 
      search: search || '', 
      type: typeList.sort().join(','), 
      year: yearList.sort().join(','), 
      platform: platformList.sort().join(','), 
      country: countryList.sort().join(','), 
      sort: sort || 'dateDesc', 
      page, 
      per_page 
    });
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const offset = (page - 1) * per_page;
    
    let sql = 'SELECT id, title, altTitle, year, country, type, category, platform, rating, poster, poster_mime, tmdbUrl, archiveDate, notes, createdAt, updatedAt, (poster_data IS NOT NULL AND poster_data != \'\') as has_poster_data FROM movies WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM movies WHERE 1=1';
    const params = [];
    const countParams = [];

    if (search) {
      sql += ' AND (title LIKE ? OR altTitle LIKE ? OR JSON_SEARCH(tags, \'one\', ?) IS NOT NULL)';
      countSql += ' AND (title LIKE ? OR altTitle LIKE ? OR JSON_SEARCH(tags, \'one\', ?) IS NOT NULL)';
      const like = `%${search}%`;
      params.push(like, like, `%${search}%`);
      countParams.push(like, like, `%${search}%`);
    }
    if (typeList.length > 0) {
      sql += ' AND type IN (?)';
      countSql += ' AND type IN (?)';
      params.push(typeList);
      countParams.push(typeList);
    }
    if (yearList.length > 0) {
      sql += ' AND LEFT(archiveDate, 4) IN (?)';
      countSql += ' AND LEFT(archiveDate, 4) IN (?)';
      params.push(yearList);
      countParams.push(yearList);
    }
    if (platformList.length > 0) {
      sql += ' AND platform IN (?)';
      countSql += ' AND platform IN (?)';
      params.push(platformList);
      countParams.push(platformList);
    }
    if (countryList.length > 0) {
      sql += ' AND country IN (?)';
      countSql += ' AND country IN (?)';
      params.push(countryList);
      countParams.push(countryList);
    }

    const sortMap = {
      dateDesc: 'archiveDate DESC',
      dateAsc: 'archiveDate ASC',
      ratingDesc: 'rating DESC',
      ratingAsc: 'rating ASC',
      titleAsc: 'title ASC'
    };
    sql += ' ORDER BY ' + (sortMap[sort] || 'archiveDate DESC');
    sql += ' LIMIT ? OFFSET ?';
    params.push(parseInt(per_page), parseInt(offset));

    const [rows] = await pool.query(sql, params);
    const [countResult] = await pool.query(countSql, countParams);
    
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / per_page);

    const parsed = rows.map(row => ({
      ...row,
      has_poster_data: row.has_poster_data === 1 || row.has_poster_data === true,
      rating: row.rating ? Number(row.rating) : 0,
      year: row.year ? Number(row.year) : 0,
    }));

    res.json({ 
      success: true, 
      data: parsed, 
      total,
      page: parseInt(page),
      per_page: parseInt(per_page),
      total_pages: totalPages
    });
    
    await cache.set(cacheKey, { 
      success: true, 
      data: parsed, 
      total,
      page: parseInt(page),
      per_page: parseInt(per_page),
      total_pages: totalPages
    }).catch(() => {});
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/countries', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT name FROM countries ORDER BY name');
    res.json({ success: true, data: rows.map(r => r.name) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

async function ensureCountryExists(countryName) {
  if (!countryName || countryName.trim() === '') return;
  const names = countryName.split(/[\/,，、]+/).map(s => s.trim()).filter(Boolean);
  for (const name of names) {
    try {
      await pool.query('INSERT IGNORE INTO countries (name) VALUES (?)', [name]);
    } catch (e) {
      // Ignore duplicate errors
    }
  }
}

router.get('/stats', async (req, res) => {
  try {
    const [total] = await pool.query('SELECT COUNT(*) as total FROM movies');
    const [avg] = await pool.query('SELECT ROUND(AVG(rating),1) as avg FROM movies WHERE rating > 0');
    const [movies] = await pool.query("SELECT COUNT(*) as count FROM movies WHERE type='电影'");
    const [series] = await pool.query("SELECT COUNT(*) as count FROM movies WHERE type='剧集'");
    const [platforms] = await pool.query('SELECT platform, COUNT(*) as count FROM movies WHERE platform != "" GROUP BY platform ORDER BY count DESC');
    const [years] = await pool.query("SELECT LEFT(archiveDate, 4) as year, COUNT(*) as count FROM movies WHERE archiveDate != '' GROUP BY LEFT(archiveDate, 4) ORDER BY year DESC");

    res.json({
      success: true,
      data: {
        total: total[0].total,
        avgRating: avg[0].avg || 0,
        movieCount: movies[0].count,
        seriesCount: series[0].count,
        platforms: platforms,
        years: years
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/annual/:year', async (req, res) => {
  try {
    const { year } = req.params;

    // Stats for the year
    const [total] = await pool.query("SELECT COUNT(*) as total FROM movies WHERE LEFT(archiveDate, 4) = ?", [year]);
    const [avg] = await pool.query("SELECT ROUND(AVG(rating),1) as avg FROM movies WHERE LEFT(archiveDate, 4) = ? AND rating > 0", [year]);
    const [movies] = await pool.query("SELECT COUNT(*) as count FROM movies WHERE LEFT(archiveDate, 4) = ? AND type='电影'", [year]);
    const [series] = await pool.query("SELECT COUNT(*) as count FROM movies WHERE LEFT(archiveDate, 4) = ? AND type='剧集'", [year]);
    const [platforms] = await pool.query("SELECT platform, COUNT(*) as count FROM movies WHERE LEFT(archiveDate, 4) = ? AND platform != '' GROUP BY platform ORDER BY count DESC", [year]);

    // All movies for the year
    const [rows] = await pool.query(
      "SELECT id, title, type, platform, rating, poster, poster_mime, tmdbUrl, (poster_data IS NOT NULL AND poster_data != '') as has_poster_data FROM movies WHERE LEFT(archiveDate, 4) = ? ORDER BY archiveDate DESC",
      [year]
    );

    const parsed = rows.map(row => ({
      ...row,
      has_poster_data: row.has_poster_data === 1 || row.has_poster_data === true,
    }));

    res.json({
      success: true,
      data: {
        year: parseInt(year),
        total: total[0].total,
        avgRating: avg[0].avg || 0,
        movieCount: movies[0].count,
        seriesCount: series[0].count,
        platforms: platforms,
        movies: parsed,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM movies WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Movie not found' });
    }
    const movie = rows[0];
    const hasPosterData = !!movie.poster_data;
    delete movie.poster_data;
    delete movie.poster_mime;
    movie.rating = movie.rating ? Number(movie.rating) : 0;
    movie.year = movie.year ? Number(movie.year) : 0;
    movie.has_poster_data = hasPosterData;
    res.json({ success: true, data: movie });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, altTitle, year, country, type, category, platform, rating, poster, tmdbUrl, archiveDate, notes } = req.body;

    if (!title || !type || !platform || !archiveDate) {
      return res.status(400).json({ success: false, message: '请填写必填项' });
    }

    await ensureCountryExists(country);

    const [result] = await pool.query(
      `INSERT INTO movies (title, altTitle, year, country, type, category, platform, rating, poster, tmdbUrl, archiveDate, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, altTitle || '', year || 0, country || '', type, category || '', platform, rating || 0, poster || '', tmdbUrl || '', archiveDate, notes || '']
    );

    cache.flushMovies().catch(() => {});
    res.json({ success: true, data: { id: result.insertId }, message: '新增成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { title, altTitle, year, country, type, category, platform, rating, poster, tmdbUrl, archiveDate, notes } = req.body;

    if (!title || !type || !platform || !archiveDate) {
      return res.status(400).json({ success: false, message: '请填写必填项' });
    }

    const [currentRows] = await pool.query('SELECT poster, poster_data FROM movies WHERE id = ?', [req.params.id]);
    const currentPoster = currentRows[0]?.poster || '';
    const hadPosterData = !!currentRows[0]?.poster_data;
    
    let posterDataSql = '';
    let posterChanged = false;
    if (poster && poster !== currentPoster) {
      posterDataSql = ', poster_data = NULL, poster_mime = NULL';
      posterChanged = true;
    }

    await ensureCountryExists(country);

    await pool.query(
      `UPDATE movies SET title=?, altTitle=?, year=?, country=?, type=?, category=?, platform=?, rating=?, poster=?, tmdbUrl=?, archiveDate=?, notes=?${posterDataSql} WHERE id=?`,
      [title, altTitle || '', year || 0, country || '', type, category || '', platform, rating || 0, poster || '', tmdbUrl || '', archiveDate, notes || '', req.params.id]
    );

    const updatedData = {
      title,
      altTitle: altTitle || '',
      year: year || 0,
      country: country || '',
      type,
      category: category || '',
      platform,
      rating: rating || 0,
      poster: poster || '',
      tmdbUrl: tmdbUrl || '',
      archiveDate,
      notes: notes || '',
      has_poster_data: !posterChanged && hadPosterData
    };
    await cache.updateMovieInCache(req.params.id, updatedData);

    res.json({ success: true, message: '更新成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM movies WHERE id = ?', [req.params.id]);
    cache.flushMovies().catch(() => {});
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

async function downloadAndStorePoster(posterUrl) {
  try {
    const resp = await proxyAxios.get(posterUrl, { responseType: 'arraybuffer' });
    const contentType = resp.headers['content-type'] || 'image/jpeg';
    return { data: Buffer.from(resp.data), mime: contentType };
  } catch (e) {
    return null;
  }
}

router.post('/fetch-poster/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM movies WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '电影不存在' });

    const movie = rows[0];
    if (movie.poster_data) return res.json({ success: true, message: '已有海报' });

    // Use TMDB directly
    let posterUrl = null;
    try {
      const tmdb = require('../tmdb');
      if (tmdb.isConfigured()) {
        posterUrl = await tmdb.findPosterByTitle(movie.title, movie.altTitle, movie.tmdbUrl, movie.type);
      }
    } catch (e) {
      console.log('TMDB获取海报失败:', movie.title, e.message);
    }

    // Fallback to Douban web scrape if TMDB fails
    if (!posterUrl) {
      let doubanId = null;
      if (movie.tmdbUrl) {
        // Try to extract douban ID from tmdbUrl (backward compatibility)
      }
      if (doubanId) {
        try {
          const doubanScraper = require('../douban_scraper');
          posterUrl = await doubanScraper.scrapePoster(doubanId);
        } catch (e) {
          console.log('豆瓣网页抓取失败:', movie.title, e.message);
        }
      }
    }

    if (posterUrl) {
      const image = await downloadAndStorePoster(posterUrl);
      if (image) {
        await pool.query(
          'UPDATE movies SET poster = ?, poster_data = ?, poster_mime = ? WHERE id = ?',
          [posterUrl, image.data, image.mime, id]
        );
        cache.flushMovies().catch(() => {});
        res.json({ success: true, message: '海报获取成功' });
      } else {
        await pool.query('UPDATE movies SET poster = ? WHERE id = ?', [posterUrl, id]);
        res.json({ success: true, message: '海报URL已保存（图片下载失败）', poster: posterUrl });
      }
    } else {
      res.json({ success: false, message: '未找到海报' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/poster/:id/image', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT poster_data, poster_mime FROM movies WHERE id = ? AND poster_data IS NOT NULL', [req.params.id]);
    if (rows.length === 0) return res.status(404).send('Poster not found');
    const row = rows[0];
    res.set('Content-Type', row.poster_mime || 'image/jpeg');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(row.poster_data);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

const axiosTmdb = axios.create({
  proxy: PROXY,
  httpsAgent: AGENT,
  timeout: 15000,
});

async function fetchFromTmdb(title) {
  const tmdb = require('../tmdb');
  const key = tmdb.getApiKey();
  if (!key) return null;

  const seasonMatch = title.match(/(.+?)[\s　]*第[一二三四五六七八九十\d]+季$/);
  const searchQ = seasonMatch ? seasonMatch[1].trim() : title;

  try {
    const sr = await axiosTmdb.get(`https://api.themoviedb.org/3/search/multi?api_key=${key}&query=${encodeURIComponent(searchQ)}&language=zh-CN&page=1`);
    const results = sr.data.results || [];
    if (results.length === 0) return null;

    let best = results[0];
    for (const r of results) {
      if (r.media_type !== 'movie' && r.media_type !== 'tv') continue;
      const names = [r.title, r.name, r.original_title, r.original_name].filter(Boolean);
      if (names.some(n => n === searchQ)) { best = r; break; }
    }

    const isTv = best.media_type === 'tv';
    let detail;
    try {
      const detResp = await axiosTmdb.get(`https://api.themoviedb.org/3/${isTv ? 'tv' : 'movie'}/${best.id}?api_key=${key}&language=zh-CN`);
      detail = detResp.data;
    } catch { detail = best; }

    const d = detail || best;
     const year = d.release_date ? parseInt(d.release_date.slice(0, 4)) : (d.first_air_date ? parseInt(d.first_air_date.slice(0, 4)) : 0);
     const genres = d.genres ? d.genres.map(g => g.name) : [];

     return { year: isNaN(year) ? 0 : year, genres };
  } catch {
    return null;
  }
}

router.post('/batch-fill', async (req, res) => {
  req.setTimeout(600000);
  try {
    const [rows] = await pool.query(
      "SELECT id, title FROM movies WHERE year IS NULL OR year = 0 OR year = '' OR category IS NULL OR category = '' ORDER BY id ASC"
    );

    const total = rows.length;
    let filled = 0;
    let failed = 0;

    for (const movie of rows) {
      try {
        const info = await fetchFromTmdb(movie.title);
        if (info && (info.year > 0 || info.genres.length > 0)) {
          const updates = [];
          const params = [];

          if (info.year > 0) {
            updates.push('year = ?');
            params.push(info.year);
          }
          if (info.genres.length > 0) {
            updates.push('category = ?');
            params.push(info.genres.join(', '));
          }

          if (updates.length > 0) {
            params.push(movie.id);
            await pool.query(`UPDATE movies SET ${updates.join(', ')} WHERE id = ?`, params);
            filled++;
          }
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    cache.flushMovies().catch(() => {});
    res.json({ success: true, data: { total, processed: total, filled, failed, done: true } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
