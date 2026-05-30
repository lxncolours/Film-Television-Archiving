const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'movie_archive',
  });

  const [cols] = await conn.query('SHOW COLUMNS FROM movies');
  const colNames = cols.map(c => c.Field);

  if (!colNames.includes('doubanUrl')) {
    await conn.query("ALTER TABLE movies ADD COLUMN doubanUrl VARCHAR(500) DEFAULT '' AFTER poster_mime");
    console.log('Added column: doubanUrl');
  } else {
    console.log('Column doubanUrl already exists');
  }

  if (!colNames.includes('tags')) {
    await conn.query("ALTER TABLE movies ADD COLUMN tags VARCHAR(500) DEFAULT '' AFTER category");
    console.log('Added column: tags');
  } else {
    console.log('Column tags already exists');
  }

  console.log('Migration completed successfully');
  await conn.end();
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
