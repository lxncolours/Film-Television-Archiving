const mysql = require('mysql2/promise');
(async () => {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'libereica',
    password: 'L1ber1ca',
    database: 'movie_archive',
    connectionLimit: 5
  });
  const [r] = await pool.query("SELECT COUNT(*) as cnt FROM movies WHERE poster IS NOT NULL AND poster != ''");
  const [sample] = await pool.query("SELECT id, title, poster FROM movies WHERE poster IS NOT NULL AND poster != '' LIMIT 5");
  console.log('有海报:', r[0].cnt);
  sample.forEach(s => console.log('  ', s.id, s.title, String(s.poster).substring(0, 60)));
  await pool.end();
})();
