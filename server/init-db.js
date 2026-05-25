const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

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

async function initDatabase() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
  });

  await conn.query(`CREATE DATABASE IF NOT EXISTS movie_archive DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE movie_archive`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS movies (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      altTitle VARCHAR(255) DEFAULT '',
      year INT DEFAULT 0,
      country VARCHAR(255) DEFAULT '',
      type VARCHAR(50) DEFAULT '',
      category VARCHAR(50) DEFAULT '',
      tags JSON DEFAULT NULL,
      platform VARCHAR(100) DEFAULT '',
      rating DECIMAL(3,1) DEFAULT 0,
      poster VARCHAR(500) DEFAULT '',
      doubanUrl VARCHAR(500) DEFAULT '',
      archiveDate VARCHAR(50) DEFAULT '',
      notes TEXT DEFAULT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('Database and table initialized successfully');
  await conn.end();
}

initDatabase().catch(err => {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
});
