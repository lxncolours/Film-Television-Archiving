const express = require('express');
const router = express.Router();
const pool = require('../db');
const cache = require('../redis');
const sortConfig = require('../config/sortConfig');
const proxyConfig = require('../proxy-config');

const proxyAxios = proxyConfig.createAxiosInstance();

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

router.get('/', async (req, res) => {
  try {
    const { search, type, year, platform, country, sort = 'dateDesc', page = 1, per_page = 20 } = req.query;
    
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
    
    let sql = 'SELECT id, title, altTitle, year, country, type, category, platform, rating, poster, poster_mime, doubanUrl, tmdbUrl, archiveDate, notes, createdAt, updatedAt, (poster_data IS NOT NULL AND poster_data != \'\') as has_poster_data FROM movies WHERE 1=1';
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

    const sortClause = sortConfig.movies[sort];
    if (!sortClause) {
      return res.status(400).json({ success: false, message: '无效的排序参数' });
    }
    sql += ' ORDER BY ' + sortClause;
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

router.get('/export', async (req, res) => {
  try {
    const { format = 'json' } = req.query;

    const [rows] = await pool.query(
      `SELECT title, altTitle, year, country, type, category, tags, platform, rating, poster, poster_data, poster_mime, doubanUrl, tmdbUrl, archiveDate, notes, createdAt, updatedAt FROM movies ORDER BY id ASC`
    );

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
    res.status(500).json({ success: false, message: err.message });
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
      [title, altTitle || '', year || 0, country || '', type, category || '', platform, rating || 0, poster || '', tmdbUrl || '', normalizeDate(archiveDate), notes || '']
    );

    await cache.flushMovies();
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
      [title, altTitle || '', year || 0, country || '', type, category || '', platform, rating || 0, poster || '', tmdbUrl || '', normalizeDate(archiveDate), notes || '', req.params.id]
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
      archiveDate: normalizeDate(archiveDate),
      notes: notes || '',
      has_poster_data: !posterChanged && hadPosterData
    };
    await cache.updateMovieInCache(req.params.id, updatedData);
    await cache.flushMovies();

    res.json({ success: true, message: '更新成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM movies WHERE id = ?', [req.params.id]);
    await cache.flushMovies();
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

    let posterUrl = null;
    try {
      const tmdb = require('../tmdb');
      if (tmdb.isConfigured()) {
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

router.post('/import', async (req, res) => {
  try {
    const { data: movies, mode = 'append' } = req.body;

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

        if (mode === 'skip') {
          const [existing] = await conn.query('SELECT id FROM movies WHERE title = ? AND archiveDate = ?', [title, archiveDate]);
          if (existing.length > 0) {
            skipped++;
            continue;
          }
        }

        let posterDataBuf = null;
        if (movie.poster_data) {
          posterDataBuf = Buffer.from(movie.poster_data, 'base64');
        }

        let tagsJson = '[]';
        if (movie.tags) {
          tagsJson = Array.isArray(movie.tags) ? JSON.stringify(movie.tags) : String(movie.tags);
        }

        batch.push([
          title,
          movie.altTitle || '',
          movie.year || 0,
          movie.country || '',
          movie.type || '',
          movie.category || '',
          tagsJson,
          movie.platform || '',
          movie.rating || 0,
          movie.poster || '',
          posterDataBuf,
          posterDataBuf ? (movie.poster_mime || 'image/jpeg') : null,
          movie.doubanUrl || '',
          movie.tmdbUrl || '',
          archiveDate,
          movie.notes || '',
          movie.createdAt || new Date(),
          movie.updatedAt || new Date()
        ]);

        if (movie.country) {
          movie.country.split(/[\/,，、]+/).map(s => s.trim()).filter(Boolean).forEach(c => countrySet.add(c));
        }

        imported++;

        if (batch.length >= BATCH_SIZE) {
          await conn.query(
            'INSERT INTO movies (title, altTitle, year, country, type, category, tags, platform, rating, poster, poster_data, poster_mime, doubanUrl, tmdbUrl, archiveDate, notes, createdAt, updatedAt) VALUES ?',
            [batch]
          );
          batch = [];
        }
      }

      if (batch.length > 0) {
        await conn.query(
          'INSERT INTO movies (title, altTitle, year, country, type, category, tags, platform, rating, poster, poster_data, poster_mime, doubanUrl, tmdbUrl, archiveDate, notes, createdAt, updatedAt) VALUES ?',
          [batch]
        );
      }

      for (const name of countrySet) {
        await conn.query('INSERT IGNORE INTO countries (name) VALUES (?)', [name]);
      }

      await conn.commit();
      await cache.flushMovies().catch(() => {});

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
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
