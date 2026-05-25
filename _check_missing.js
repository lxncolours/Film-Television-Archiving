const mysql = require('mysql2/promise');
(async () => {
  const p = mysql.createPool({ host:'localhost', user:'libereica', password:'L1ber1ca', database:'movie_archive', connectionLimit:2 });
  const [[{total}]] = await p.query('SELECT COUNT(*) as total FROM movies');
  const [[{noBlob}]] = await p.query("SELECT COUNT(*) as noBlob FROM movies WHERE poster_data IS NULL OR poster_data = ''");
  const [[{noUrl}]] = await p.query("SELECT COUNT(*) as noUrl FROM movies WHERE (poster_data IS NULL OR poster_data = '') AND (poster IS NULL OR poster = '')");
  const [[{hasUrl}]] = await p.query("SELECT COUNT(*) as hasUrl FROM movies WHERE (poster_data IS NULL OR poster_data = '') AND poster IS NOT NULL AND poster != ''");
  console.log('总影片:', total, '| 无海报数据:', noBlob, '| 有URL无数据:', hasUrl, '| 无URL无数据:', noUrl);
  
  if (noUrl > 0) {
    const [rows] = await p.query("SELECT id, title, altTitle, doubanUrl FROM movies WHERE (poster_data IS NULL OR poster_data = '') AND (poster IS NULL OR poster = '') LIMIT 10");
    console.log('无URL无数据的电影样例:');
    rows.forEach(r => console.log('  id:', r.id, '|', r.title, '| doubanUrl:', r.doubanUrl || '(空)'));
  }
  await p.end();
})();
