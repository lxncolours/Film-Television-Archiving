const express = require('express');
const router = express.Router();
const pool = require('../db');
const tmdb = require('../tmdb');

router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.json({ success: false, message: '请提供搜索关键词' });
    }

    if (!await tmdb.isConfigured()) {
      return res.json({ success: false, message: 'TMDB 未配置' });
    }

    const si = tmdb.parseSeasonInfo(q);
    let searchQ = si.season > 0 && si.base ? si.base : q;

    console.log(`搜索查询: "${q}", 解析季数: ${si.season}, 搜索关键词: "${searchQ}"`);

    let results = await tmdb.searchMulti(searchQ);
    console.log(`TMDB搜索结果数量(使用base): ${results.length}`);

    if (si.season > 0 && si.base && results.length === 0) {
      console.log(`使用base搜索无结果，尝试使用原始查询 "${q}"`);
      results = await tmdb.searchMulti(q);
      console.log(`TMDB搜索结果数量(使用原始): ${results.length}`);
    }

    const data = results
      .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
      .slice(0, 10)
      .map(r => ({
        id: r.id,
        title: r.title || r.name || '',
        year: (r.release_date || r.first_air_date || '').slice(0, 4),
        rating: r.vote_average ? Math.round(r.vote_average) : 0,
        cover: r.poster_path ? tmdb.getPosterUrl(r.poster_path, 'w342') : '',
        country: (r.origin_country || []).join(', '),
        media_type: r.media_type,
        source: 'tmdb',
      }));

    res.json({ success: true, data });
  } catch (error) {
    console.error('搜索API错误:', error.message);
    res.json({ success: false, message: '搜索失败', error: error.message });
  }
});

router.get('/detail/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.json({ success: false, message: '请提供影片ID' });
    }

    const [rows] = await pool.query(`SELECT * FROM movies WHERE id = ?`, [id]);
    if (rows.length > 0) {
      const movie = rows[0];
      return res.json({
        success: true,
        data: {
          title: movie.title,
          altTitle: movie.altTitle,
          year: movie.year,
          countries: movie.country,
          genres: movie.category ? movie.category.split(/[,，]/).map(s => s.trim()) : [],
          directors: '',
          rating: movie.rating,
          poster: movie.poster,
          tmdbUrl: movie.tmdbUrl,
          source: 'local',
        },
      });
    }

    res.json({ success: false, message: '未找到影片' });
  } catch (error) {
    console.error('详情API错误:', error.message);
    res.json({ success: false, message: '获取详情失败', error: error.message });
  }
});

module.exports = router;
