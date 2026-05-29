const mysql = require('mysql2/promise');
const { loadEnv } = require('./utils/env');

loadEnv();

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
      poster_data MEDIUMBLOB DEFAULT NULL,
      poster_mime VARCHAR(50) DEFAULT NULL,
      doubanUrl VARCHAR(500) DEFAULT '',
      tmdbUrl VARCHAR(500) DEFAULT '',
      archiveDate VARCHAR(50) DEFAULT '',
      notes TEXT DEFAULT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS countries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('Database and table initialized successfully');
  await conn.end();
}

initDatabase().catch(err => {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
});
