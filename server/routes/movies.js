const express = require('express');
const router = express.Router();
const pool = require('../db');
const cache = require('../redis');
const sortConfig = require('../config/sortConfig');
const proxyConfig = require('../proxy-config');
const logger = require('../utils/logger');

const proxyAxios = () => proxyConfig.createAxiosInstance();

function parseArrayParam(param) {
  if (!param) return [];
  if (Array.isArray(param)) return param.filter(Boolean);
  if (typeof param === 'string') {
    return param.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function normalizeDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.replace(/\//g, '-');
}

// 将任意形态的 tags 统一解析为字符串数组：JSON 数组 / 数组 / 逗号分隔字符串 / null
function parseTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.filter(Boolean).map(String);
  if (typeof tags === 'string') {
    const trimmed = tags.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      // 非 JSON，按分隔符切分
    }
    return trimmed.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function normalizeDateTime(dt) {
  if (!dt) return new Date();
  if (dt instanceof Date) return dt;
  const d = new Date(dt);
  if (isNaN(d.getTime())) return new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

router.get('/', async (req, res) => {
  try {
    const { search, type, year, platform, country, category, tag, sort = 'dateDesc', page = 1, per_page = 20 } = req.query;
    
    const typeList = parseArrayParam(type);
    const yearList = parseArrayParam(year);
    const platformList = parseArrayParam(platform);
    const countryList = parseArrayParam(country);
    const categoryList = parseArrayParam(category);
    const tagList = parseArrayParam(tag);
    
    logger.info(`[Movies] GET / list search="${search || ''}" type=${typeList.join(',')} year=${yearList.join(',')} platform=${platformList.join(',')} country=${countryList.join(',')} category=${categoryList.join(',')} tag=${tagList.join(',')} sort=${sort} page=${page} per_page=${per_page}`);
    
    const cacheKey = cache.makeKey('list', { 
      search: search || '', 
      type: typeList.sort().join(','), 
      year: yearList.sort().join(','), 
      platform: platformList.sort().join(','), 
      country: countryList.sort().join(','), 
      category: categoryList.sort().join(','),
      tag: tagList.sort().join(','),
      sort: sort || 'dateDesc', 
      page, 
      per_page 
    });
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const pageNum = parseInt(page);
    const perPageNum = parseInt(per_page);
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ success: false, message: '无效的页码' });
    }
    if (isNaN(perPageNum) || perPageNum < 1 || perPageNum > 100) {
      return res.status(400).json({ success: false, message: '每页数量需在 1-100 之间' });
    }

    const offset = (pageNum - 1) * perPageNum;
    
    let sql = 'SELECT id, title, altTitle, year, country, type, category, tags, platform, rating, poster, poster_mime, doubanUrl, tmdbUrl, archiveDate, notes, createdAt, updatedAt, (poster_data IS NOT NULL AND poster_data != \'\') as has_poster_data FROM movies WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM movies WHERE 1=1';
    const params = [];
    const countParams = [];

    if (search) {
      sql += ' AND (title LIKE ? OR altTitle LIKE ?)';
      countSql += ' AND (title LIKE ? OR altTitle LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like);
      countParams.push(like, like);
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
    if (categoryList.length > 0) {
      sql += ' AND category IN (?)';
      countSql += ' AND category IN (?)';
      params.push(categoryList);
      countParams.push(categoryList);
    }
    if (tagList.length > 0) {
      // tags 为 JSON 数组，JSON_OVERLAPS 匹配"包含任一所选标签"；tags 为 NULL 时不命中
      sql += ' AND JSON_OVERLAPS(tags, ?)';
      countSql += ' AND JSON_OVERLAPS(tags, ?)';
      const tagJson = JSON.stringify(tagList);
      params.push(tagJson);
      countParams.push(tagJson);
    }

    const sortClause = sortConfig.movies[sort];
    if (!sortClause) {
      return res.status(400).json({ success: false, message: '无效的排序参数' });
    }
    sql += ' ORDER BY ' + sortClause;
    sql += ' LIMIT ? OFFSET ?';
    params.push(perPageNum, offset);

    const [rows] = await pool.query(sql, params);
    const [countResult] = await pool.query(countSql, countParams);
    
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / perPageNum);
    logger.info(`[Movies] GET / list result total=${total} page=${pageNum} per_page=${perPageNum}`);

    const parsed = rows.map(row => ({
      ...row,
      has_poster_data: row.has_poster_data === 1 || row.has_poster_data === true,
      rating: row.rating ? Number(row.rating) : 0,
      year: row.year ? Number(row.year) : 0,
      tags: parseTags(row.tags),
    }));

    res.json({ 
      success: true, 
      data: parsed, 
      total,
      page: pageNum,
      per_page: perPageNum,
      total_pages: totalPages
    });
    
    await cache.set(cacheKey, { 
      success: true, 
      data: parsed, 
      total,
      page: pageNum,
      per_page: perPageNum,
      total_pages: totalPages
    }).catch(() => {});
  } catch (err) {
    logger.error(`[Movies] GET / list error: ${err.message}`);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

router.get('/countries', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT name FROM countries ORDER BY name');
    logger.info(`[Movies] GET /countries result count=${rows.length}`);
    res.json({ success: true, data: rows.map(r => r.name) });
  } catch (err) {
    logger.error(`[Movies] GET /countries error: ${err.message}`);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 聚合所有标签（含每标签使用次数），供筛选面板动态渲染
// 注意：必须定义在 /:id 之前，否则会被 /:id 路由拦截
router.get('/tags', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT tags FROM movies WHERE tags IS NOT NULL AND tags != ''");
    const counter = new Map();
    for (const row of rows) {
      for (const tag of parseTags(row.tags)) {
        counter.set(tag, (counter.get(tag) || 0) + 1);
      }
    }
    const data = [...counter.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    logger.info(`[Movies] GET /tags result count=${data.length}`);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[Movies] GET /tags error: ${err.message}`);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 聚合所有分类（category 为逗号分隔字符串，需拆分统计）
router.get('/categories', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT category FROM movies WHERE category IS NOT NULL AND category != ''");
    const counter = new Map();
    for (const row of rows) {
      for (const c of String(row.category).split(/[,，、]/).map(s => s.trim()).filter(Boolean)) {
        counter.set(c, (counter.get(c) || 0) + 1);
      }
    }
    const data = [...counter.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    logger.info(`[Movies] GET /categories result count=${data.length}`);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(`[Movies] GET /categories error: ${err.message}`);
    res.status(500).json({ success: false, message: '服务器内部错误' });
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
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
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
    logger.info(`[Movies] GET /stats result total=${total[0].total} movies=${movies[0].count} series=${series[0].count}`);
  } catch (err) {
    logger.error(`[Movies] GET /stats error: ${err.message}`);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

router.get('/annual/:year', async (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    const { year } = req.params;
    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ success: false, message: '无效的年份格式' });
    }
    const [total] = await pool.query("SELECT COUNT(*) as total FROM movies WHERE LEFT(archiveDate, 4) = ?", [year]);
    const [avg] = await pool.query("SELECT ROUND(AVG(rating),1) as avg FROM movies WHERE LEFT(archiveDate, 4) = ? AND rating > 0", [year]);
    const [movies] = await pool.query("SELECT COUNT(*) as count FROM movies WHERE LEFT(archiveDate, 4) = ? AND type='电影'", [year]);
    const [series] = await pool.query("SELECT COUNT(*) as count FROM movies WHERE LEFT(archiveDate, 4) = ? AND type='剧集'", [year]);
    const [platforms] = await pool.query("SELECT platform, COUNT(*) as count FROM movies WHERE LEFT(archiveDate, 4) = ? AND platform != '' GROUP BY platform ORDER BY count DESC", [year]);

    // All movies for the year
    const [rows] = await pool.query(
      "SELECT id, title, type, platform, rating, archiveDate, poster, poster_mime, tmdbUrl, (poster_data IS NOT NULL AND poster_data != '') as has_poster_data FROM movies WHERE LEFT(archiveDate, 4) = ? ORDER BY archiveDate DESC, id DESC",
      [year]
    );

    const parsed = rows.map(row => ({
      ...row,
      has_poster_data: row.has_poster_data === 1 || row.has_poster_data === true,
    }));

    // ===== 月度趋势：统计 1-12 月每月归档数量 =====
    const monthlyMap = new Map();
    for (let m = 1; m <= 12; m++) monthlyMap.set(m, 0);
    let mostProductiveMonth = { month: 0, count: 0 };
    for (const row of rows) {
      if (!row.archiveDate) continue;
      const m = parseInt(String(row.archiveDate).slice(5, 7), 10);
      if (m >= 1 && m <= 12) {
        const c = (monthlyMap.get(m) || 0) + 1;
        monthlyMap.set(m, c);
        if (c > mostProductiveMonth.count) mostProductiveMonth = { month: m, count: c };
      }
    }
    const monthly = [...monthlyMap.entries()].map(([month, count]) => ({ month, count }));

    // ===== 评分分布：按 [0-6) [6-7) [7-8) [8-9) [9-10] 分桶 =====
    const ratingBuckets = [
      { label: '<6', min: 0, max: 6, count: 0 },
      { label: '6-7', min: 6, max: 7, count: 0 },
      { label: '7-8', min: 7, max: 8, count: 0 },
      { label: '8-9', min: 8, max: 9, count: 0 },
      { label: '9-10', min: 9, max: 10.01, count: 0 },
    ];
    let ratedCount = 0;
    for (const row of rows) {
      const r = Number(row.rating);
      if (!r || r <= 0) continue;
      ratedCount++;
      for (const b of ratingBuckets) {
        if (r >= b.min && r < b.max) { b.count++; break; }
      }
    }

    // ===== 类型分布 =====
    const typeMap = new Map();
    for (const row of rows) {
      const t = row.type || '未知';
      typeMap.set(t, (typeMap.get(t) || 0) + 1);
    }
    const typeDist = [...typeMap.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    // ===== 年度最佳 / 最差（按评分） =====
    const rated = rows.filter(r => Number(r.rating) > 0)
      .sort((a, b) => Number(b.rating) - Number(a.rating));
    const best = rated.length ? { id: rated[0].id, title: rated[0].title, rating: Number(rated[0].rating) } : null;
    const worst = rated.length ? { id: rated[rated.length - 1].id, title: rated[rated.length - 1].title, rating: Number(rated[rated.length - 1].rating) } : null;

    logger.info(`[Movies] GET /annual/${year} result total=${total[0].total} movies=${parsed.length}`);

    res.json({
      success: true,
      data: {
        year: parseInt(year),
        total: total[0].total,
        avgRating: avg[0].avg || 0,
        movieCount: movies[0].count,
        seriesCount: series[0].count,
        platforms: platforms,
        monthly,
        mostProductiveMonth,
        ratingDist: ratingBuckets,
        ratedCount,
        typeDist,
        best,
        worst,
        movies: parsed,
      }
    });
  } catch (err) {
    logger.error(`[Movies] GET /annual/${req.params.year} error: ${err.message}`);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

router.get('/export', async (req, res) => {
  try {
    const { format = 'json' } = req.query;

    const [rows] = await pool.query(
      `SELECT title, altTitle, year, country, type, category, tags, platform, rating, poster, poster_data, poster_mime, doubanUrl, tmdbUrl, archiveDate, notes, createdAt, updatedAt FROM movies ORDER BY id ASC`
    );

    logger.info(`[Movies] GET /export format=${format} count=${rows.length}`);

    if (format === 'csv') {
      const headers = ['片名', '其他片名', '上映年份', '国家/地区', '类型', '分类', '标签', '观看平台', '评分', '海报链接', '豆瓣链接', 'TMDB链接', '归档日期', '备注'];
      const rows_csv = rows.map(row => {
        const tags = row.tags ? (() => { try { return JSON.parse(row.tags); } catch { return []; } })() : [];
        return [
          escapeCsvField(row.title),
          escapeCsvField(row.altTitle),
          row.year,
          escapeCsvField(row.country),
          escapeCsvField(row.type),
          escapeCsvField(row.category),
          escapeCsvField(tags.join(',')),
          escapeCsvField(row.platform),
          row.rating,
          escapeCsvField(row.poster),
          escapeCsvField(row.doubanUrl),
          escapeCsvField(row.tmdbUrl),
          escapeCsvField(row.archiveDate),
          escapeCsvField(row.notes || ''),
        ].join(',');
      }).join('\n');

      const bom = '\uFEFF';
      const csv = bom + headers.join(',') + '\n' + rows_csv;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="movie-archive-export.csv"');
      res.send(csv);
      return;
    }

    const movies = rows.map(row => {
      const movie = { ...row };
      if (movie.poster_data) {
        movie.poster_data = Buffer.from(movie.poster_data).toString('base64');
      }
      if (movie.tags && typeof movie.tags === 'string') {
        try { movie.tags = JSON.parse(movie.tags); } catch { movie.tags = []; }
      }
      movie.rating = Number(movie.rating);
      movie.year = Number(movie.year);
      return movie;
    });

    res.json({
      success: true,
      version: 1,
      exportedAt: new Date().toISOString(),
      total: movies.length,
      data: movies
    });
  } catch (err) {
    logger.error(`[Movies] GET /export error: ${err.message}`);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

function escapeCsvField(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

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
    logger.error(`[Movies] GET /${req.params.id} error: ${err.message}`);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, altTitle, year, country, type, category, tags, platform, rating, poster, tmdbUrl, archiveDate, notes } = req.body;

    if (!title || !type || !platform || !archiveDate) {
      return res.status(400).json({ success: false, message: '请填写必填项' });
    }

    logger.info(`[Movies] POST / create title="${title}" type=${type} platform=${platform} year=${year} country=${country} category=${category}`);

    await ensureCountryExists(country);

    // tags 为 JSON 列，必须写入合法 JSON（空数组而非空字符串）
    const tagsJson = JSON.stringify(parseTags(tags));

    const [result] = await pool.query(
      `INSERT INTO movies (title, altTitle, year, country, type, category, tags, platform, rating, poster, tmdbUrl, archiveDate, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, altTitle || '', year || 0, country || '', type, category || '', tagsJson, platform, rating || 0, poster || '', tmdbUrl || '', normalizeDate(archiveDate), notes || '']
    );

    await cache.flushMovies();
    res.json({ success: true, data: { id: result.insertId }, message: '新增成功' });
  } catch (err) {
    logger.error(`[Movies] POST / create error: ${err.message}`);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { title, altTitle, year, country, type, category, tags, platform, rating, poster, tmdbUrl, archiveDate, notes } = req.body;

    if (!title || !type || !platform || !archiveDate) {
      return res.status(400).json({ success: false, message: '请填写必填项' });
    }

    logger.info(`[Movies] PUT /${req.params.id} update title="${title}" type=${type} platform=${platform} year=${year} country=${country} category=${category}`);

    const [currentRows] = await pool.query('SELECT poster, poster_data, tags FROM movies WHERE id = ?', [req.params.id]);
    const currentPoster = currentRows[0]?.poster || '';
    const hadPosterData = !!currentRows[0]?.poster_data;
    
    let posterDataSql = '';
    let posterChanged = false;
    if (poster && poster !== currentPoster) {
      posterDataSql = ', poster_data = NULL, poster_mime = NULL';
      posterChanged = true;
    }

    await ensureCountryExists(country);

    // tags 未提供时保持原值，避免旧版前端 / 部分更新把已有标签清空
    const tagsJson = tags !== undefined ? JSON.stringify(parseTags(tags)) : null;
    const tagsSql = tagsJson !== null ? ', tags=?' : '';

    const updateParams = [title, altTitle || '', year || 0, country || '', type, category || ''];
    if (tagsJson !== null) updateParams.push(tagsJson);
    updateParams.push(platform, rating || 0, poster || '', tmdbUrl || '', normalizeDate(archiveDate), notes || '', req.params.id);

    await pool.query(
      `UPDATE movies SET title=?, altTitle=?, year=?, country=?, type=?, category=?${tagsSql}, platform=?, rating=?, poster=?, tmdbUrl=?, archiveDate=?, notes=?${posterDataSql} WHERE id=?`,
      updateParams
    );

    const updatedData = {
      title,
      altTitle: altTitle || '',
      year: year || 0,
      country: country || '',
      type,
      category: category || '',
      tags: tags !== undefined ? parseTags(tags) : parseTags(currentRows[0]?.tags),
      platform,
      rating: rating || 0,
      poster: poster || '',
      tmdbUrl: tmdbUrl || '',
      archiveDate: normalizeDate(archiveDate),
      notes: notes || '',
      has_poster_data: !posterChanged && hadPosterData
    };
    await cache.updateMovieInCache(req.params.id, updatedData);
    await cache.flushMovies();

    res.json({ success: true, message: '更新成功' });
  } catch (err) {
    logger.error(`[Movies] PUT /${req.params.id} update error: ${err.message}`);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    logger.info(`[Movies] DELETE /${req.params.id} delete`);
    await pool.query('DELETE FROM movies WHERE id = ?', [req.params.id]);
    await cache.flushMovies();
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    logger.error(`[Movies] DELETE /${req.params.id} error: ${err.message}`);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

async function downloadAndStorePoster(posterUrl) {
  try {
    const resp = await proxyAxios().get(posterUrl, { responseType: 'arraybuffer' });
    const contentType = resp.headers['content-type'] || 'image/jpeg';
    return { data: Buffer.from(resp.data), mime: contentType };
  } catch (e) {
    return null;
  }
}

router.post('/fetch-poster/:id', async (req, res) => {
  try {
    const { id } = req.params;
    logger.info(`[Movies] POST /fetch-poster/${id}`);
    const [rows] = await pool.query('SELECT * FROM movies WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '电影不存在' });

    const movie = rows[0];
    if (movie.poster_data) return res.json({ success: true, message: '已有海报' });

    let posterUrl = null;
    try {
      const tmdb = require('../tmdb');
      if (await tmdb.isConfigured()) {
        posterUrl = await tmdb.findPosterByTitle(movie.title, movie.altTitle, movie.tmdbUrl, movie.type);
      }
    } catch (e) {
      console.log('TMDB获取海报失败:', movie.title, e.message);
    }

    if (posterUrl) {
      const image = await downloadAndStorePoster(posterUrl);
      if (image) {
        await pool.query(
          'UPDATE movies SET poster = ?, poster_data = ?, poster_mime = ? WHERE id = ?',
          [posterUrl, image.data, image.mime, id]
        );
        await cache.flushMovies();
        res.json({ success: true, message: '海报获取成功' });
      } else {
        await pool.query('UPDATE movies SET poster = ? WHERE id = ?', [posterUrl, id]);
        res.json({ success: true, message: '海报URL已保存（图片下载失败）', poster: posterUrl });
      }
    } else {
      res.json({ success: false, message: '未找到海报' });
    }
  } catch (err) {
    logger.error(`[Movies] POST /fetch-poster/${req.params.id} error: ${err.message}`);
    res.status(500).json({ success: false, message: '服务器内部错误' });
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
    logger.error(`[Movies] GET /poster/${req.params.id}/image error: ${err.message}`);
    res.status(500).send('Server error');
  }
});

router.post('/import', async (req, res) => {
  try {
    const { data: movies, mode = 'append' } = req.body;
    logger.info(`[Movies] POST /import entry count=${movies ? movies.length : 0} mode=${mode}`);

    if (!Array.isArray(movies) || movies.length === 0) {
      return res.status(400).json({ success: false, message: '请提供有效的导入数据' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      let imported = 0;
      let skipped = 0;
      const BATCH_SIZE = 50;
      let batch = [];
      const countrySet = new Set();

      for (const movie of movies) {
        const title = movie.title;
        const archiveDate = movie.archiveDate || '';

        if (!title) {
          skipped++;
          continue;
        }

        // Field validation & sanitization
        const validTitle = String(title).slice(0, 255);
        const validAltTitle = String(movie.altTitle || '').slice(0, 255);
        const validRating = Math.min(Math.max(Number(movie.rating) || 0, 0), 10);
        const validYear = (() => {
          const y = Number(movie.year);
          if (isNaN(y) || y < 1900 || y > 2100) return 0;
          return y;
        })();
        const validPlatform = String(movie.platform || '').slice(0, 100);
        const validType = String(movie.type || '').slice(0, 50);
        const validCountry = String(movie.country || '').slice(0, 255);
        const validCategory = String(movie.category || '').slice(0, 255);
        const validNotes = String(movie.notes || '').slice(0, 2000);
        const validPoster = String(movie.poster || '').slice(0, 500);
        const validDoubanUrl = String(movie.doubanUrl || '').slice(0, 500);
        const validTmdbUrl = String(movie.tmdbUrl || '').slice(0, 500);
        // Reject poster_data larger than 5MB
        const validPosterData = movie.poster_data && Buffer.byteLength(movie.poster_data, 'base64') <= 5 * 1024 * 1024 ? movie.poster_data : null;

        if (mode === 'skip') {
          const [existing] = await conn.query('SELECT id FROM movies WHERE title = ? AND archiveDate = ?', [title, archiveDate]);
          if (existing.length > 0) {
            skipped++;
            continue;
          }
        }

        let tagsJson = '[]';
        if (movie.tags) {
          tagsJson = Array.isArray(movie.tags) ? JSON.stringify(movie.tags) : String(movie.tags);
        }

        batch.push([
          validTitle,
          validAltTitle,
          validYear,
          validCountry,
          validType,
          validCategory,
          tagsJson,
          validPlatform,
          validRating,
          validPoster,
          validDoubanUrl,
          validTmdbUrl,
          archiveDate,
          validNotes,
          movie.createdAt ? normalizeDateTime(movie.createdAt) : new Date(),
          movie.updatedAt ? normalizeDateTime(movie.updatedAt) : new Date()
        ]);

        if (validCountry) {
          validCountry.split(/[\/,，、]+/).map(s => s.trim()).filter(Boolean).forEach(c => countrySet.add(c));
        }

        imported++;

        if (batch.length >= BATCH_SIZE) {
          const [result] = await conn.query(
            'INSERT INTO movies (title, altTitle, year, country, type, category, tags, platform, rating, poster, doubanUrl, tmdbUrl, archiveDate, notes, createdAt, updatedAt) VALUES ?',
            [batch]
          );
          batch = [];
        }
      }

      if (batch.length > 0) {
        await conn.query(
          'INSERT INTO movies (title, altTitle, year, country, type, category, tags, platform, rating, poster, doubanUrl, tmdbUrl, archiveDate, notes, createdAt, updatedAt) VALUES ?',
          [batch]
        );
      }

      for (const name of countrySet) {
        await conn.query('INSERT IGNORE INTO countries (name) VALUES (?)', [name]);
      }

      await conn.commit();

      for (const movie of movies) {
        if (!movie.poster_data) continue;
        try {
          const posterBuf = Buffer.from(movie.poster_data, 'base64');
          if (posterBuf.length > 0 && posterBuf.length <= 5 * 1024 * 1024) {
            await conn.query(
              'UPDATE movies SET poster_data = ?, poster_mime = ? WHERE title = ? AND archiveDate = ? LIMIT 1',
              [posterBuf, movie.poster_mime || 'image/jpeg', String(movie.title).slice(0, 255), movie.archiveDate || '']
            );
          }
        } catch (e) {
          logger.warn(`[Movies] POST /import poster update failed for "${movie.title}": ${e.message}`);
        }
      }

      await cache.flushMovies().catch(() => {});

      logger.info(`[Movies] POST /import imported=${imported} skipped=${skipped} mode=${mode}`);

      res.json({
        success: true,
        message: `导入完成: 新增 ${imported} 条${skipped > 0 ? `, 跳过 ${skipped} 条(已存在)` : ''}`,
        data: { imported, skipped }
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    logger.error(`[Movies] POST /import error: ${err.message}`);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

module.exports = router;
