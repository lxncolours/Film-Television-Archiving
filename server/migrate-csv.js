const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Load .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

async function migrateCSV() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'movie_archive'
  });

  const [existing] = await conn.query('SELECT COUNT(*) as count FROM movies');
  if (existing[0].count > 0) {
    console.log(`Database already has ${existing[0].count} records, skipping import`);
    await conn.end();
    return;
  }

  const csvPath = path.join(__dirname, '..', '观影归档.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8').replace(/^\uFEFF/, '');
  const lines = csvContent.split('\n').filter(line => line.trim());

  const headers = parseCSVLine(lines[0]);
  const titleIdx = headers.indexOf('片名');
  const altTitleIdx = headers.indexOf('其他片名');
  const yearIdx = headers.indexOf('上映年份');
  const countryIdx = headers.indexOf('国家/地区');
  const typeIdx = headers.indexOf('分类');
  const categoryIdx = headers.indexOf('分类');
  const tagIdx = headers.indexOf('标签');
  const platformIdx = headers.indexOf('观看平台');
  const ratingIdx = headers.indexOf('我的评分');
  const posterIdx = headers.indexOf('海报');
  const doubanIdx = headers.indexOf('豆瓣');
  const archiveDateIdx = headers.indexOf('归档日期');
  const notesIdx = headers.indexOf('备注');

  const insertSQL = `INSERT INTO movies (title, altTitle, year, country, type, category, tags, platform, rating, poster, doubanUrl, archiveDate, notes) VALUES ?`;

  const batchSize = 50;
  let batch = [];
  let total = 0;

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const title = fields[titleIdx] || '';
    if (!title) continue;

    const tagsStr = (fields[tagIdx] || '').replace(/"/g, '');
    const tags = tagsStr ? JSON.stringify(tagsStr.split(',').map(t => t.trim()).filter(Boolean)) : '[]';

    const yearText = fields[yearIdx] || '';
    const yearMatch = yearText.match(/\d+/);
    const year = yearMatch ? parseInt(yearMatch[0]) : 0;

    const ratingText = (fields[ratingIdx] || '').replace(/[^0-9.]/g, '');
    const rating = ratingText ? parseFloat(ratingText) : 0;

    let archiveDate = (fields[archiveDateIdx] || '').trim();
    archiveDate = archiveDate.replace(/ \d+:\d+$/, '');

    batch.push([
      title,
      fields[altTitleIdx] || '',
      year,
      fields[countryIdx] || '',
      fields[typeIdx] || '',
      fields[categoryIdx] || '',
      tags,
      fields[platformIdx] || '',
      rating,
      fields[posterIdx] || '',
      fields[doubanIdx] || '',
      archiveDate || '',
      fields[notesIdx] || ''
    ]);

    if (batch.length >= batchSize) {
      await conn.query(insertSQL, [batch]);
      total += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await conn.query(insertSQL, [batch]);
    total += batch.length;
  }

  console.log(`Successfully imported ${total} movie records`);
  await conn.end();
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}

migrateCSV().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
