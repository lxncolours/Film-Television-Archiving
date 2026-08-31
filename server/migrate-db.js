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
    await conn.query("ALTER TABLE movies ADD COLUMN tags JSON DEFAULT NULL AFTER category");
    console.log('Added column: tags (JSON)');
  } else {
    const tagsCol = cols.find(c => c.Field === 'tags');
    if (tagsCol && tagsCol.Type.toLowerCase() !== 'json') {
      // 历史迁移把 tags 建为 VARCHAR，统一转为 JSON 才能使用 JSON_OVERLAPS 做标签筛选
      try {
        await conn.query(`
          UPDATE movies SET tags = CASE
            WHEN tags IS NULL OR tags = '' THEN '[]'
            WHEN tags LIKE '[%' THEN tags
            ELSE CONCAT('["', REPLACE(REPLACE(REPLACE(tags, '，', ','), '、', ','), ',', '","'), '"]')
          END
        `);
        await conn.query("ALTER TABLE movies MODIFY COLUMN tags JSON DEFAULT NULL");
        console.log('Migrated column tags to JSON type');
      } catch (e) {
        console.error('Failed to migrate tags column to JSON:', e.message);
        console.error('Please check movies.tags values manually, they must be valid JSON arrays');
      }
    } else {
      console.log('Column tags already JSON');
    }
  }

  if (!colNames.includes('poster_file')) {
    // 海报二进制从 DB BLOB 迁到本地文件系统后，DB 只存文件名（sha1.ext）
    await conn.query("ALTER TABLE movies ADD COLUMN poster_file VARCHAR(64) DEFAULT NULL AFTER poster_mime");
    console.log('Added column: poster_file');
  } else {
    console.log('Column poster_file already exists');
  }

  console.log('Migration completed successfully');
  await conn.end();
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
