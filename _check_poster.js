const mysql = require('mysql2/promise');
(async () => {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'libereica',
    password: 'L1ber1ca',
    database: 'movie_archive',
    waitForConnections: true,
    connectionLimit: 10
  });
  const [total] = await pool.query('SELECT COUNT(*) as cnt FROM movies');
  const [withPoster] = await pool.query("SELECT COUNT(*) as cnt FROM movies WHERE poster IS NOT NULL AND poster != ''");
  const [sample] = await pool.query("SELECT id, title, poster FROM movies WHERE poster IS NOT NULL AND poster != '' LIMIT 5");
  console.log('Total:', total[0].cnt, '| With poster:', withPoster[0].cnt);
  sample.forEach(r => console.log(r.id, r.title, String(r.poster).substring(0, 80)));
  await pool.end();
})();
