#!/bin/sh
set -e

APP_VERSION=$(node -p "require('./package.json').version")
echo "=========================================="
echo "  Movie Archive Server v${APP_VERSION}"
echo "=========================================="

echo "Waiting for MySQL..."
MAX_RETRIES=30
i=0
until node -e "
  const mysql = require('mysql2/promise');
  mysql.createConnection({
    host: process.env.DB_HOST || 'mysql',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    connectTimeout: 2000
  }).then(c => { c.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  i=$((i+1))
  if [ $i -ge $MAX_RETRIES ]; then
    echo "MySQL failed to start after $MAX_RETRIES attempts"
    exit 1
  fi
  sleep 2
done
echo "MySQL is ready!"

echo "Initializing database..."
node server/init-db.js

echo "Starting Movie Archive Server v${APP_VERSION}..."
exec node server/server.js
