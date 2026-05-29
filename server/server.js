const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');

if (process.platform === 'win32') {
  try { 
    require('child_process').execSync('chcp 65001 > nul'); 
    process.stdout.write('\u001b[?7l');
  } catch {}
}
process.stdout.setEncoding('utf-8');
process.stderr.setEncoding('utf-8');

// Load .env file BEFORE any local modules that depend on it
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_NAME'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  logger.error('Error: Missing required environment variables:', missingVars.join(', '));
  logger.error('Please check your .env file');
  process.exit(1);
}

const https = require('https');
const movieRoutes = require('./routes/movies');
const doubanRoutes = require('./routes/douban');
const tmdbRoutes = require('./routes/tmdb');
const os = require('os');
const axios = require('axios');
const backgroundTasks = require('./background_tasks');
const proxyConfig = require('./proxy-config');

const app = express();
const PORT = process.env.PORT || 5280;
const VERSION = process.env.APP_VERSION || require('../package.json').version;
const AGENT = new https.Agent({ rejectUnauthorized: false });

const proxyAxios = proxyConfig.createAxiosInstance();

const corsOptions = {
  origin: true,
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ type: 'application/json' }));
app.use(express.urlencoded({ extended: true }));

// Disable cache for index.html to ensure latest code
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
  }
  next();
});

app.use(express.static(path.join(__dirname, '..'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.set('Content-Type', 'text/html; charset=utf-8');
    }
  }
}));

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use('/api/movies', movieRoutes);
app.use('/api/douban', doubanRoutes);
app.use('/api/tmdb', tmdbRoutes);

// 后台任务控制接口
app.get('/api/background/status', (req, res) => {
  res.json({ success: true, data: backgroundTasks.getStats() });
});

app.post('/api/background/start', (req, res) => {
  backgroundTasks.start();
  res.json({ success: true, message: '后台任务已启动' });
});

app.post('/api/background/stop', (req, res) => {
  backgroundTasks.stop();
  res.json({ success: true, message: '后台任务已停止' });
});

// 代理配置接口
app.get('/api/proxy/config', (req, res) => {
  res.json({ success: true, data: proxyConfig.getConfig() });
});

app.put('/api/proxy/config', (req, res) => {
  const { enabled, host, port, protocol } = req.body;
  const current = proxyConfig.getConfig();
  const newConfig = {
    enabled: enabled !== undefined ? enabled : current.enabled,
    host: host !== undefined ? host : current.host,
    port: port !== undefined ? port : current.port,
    protocol: protocol !== undefined ? protocol : current.protocol,
  };
  proxyConfig.setConfig(newConfig);
  res.json({ success: true, data: proxyConfig.getConfig(), message: '代理配置已更新' });
});

app.get('/api/proxy/image', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url');
    const response = await proxyAxios.get(decodeURIComponent(url), {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://movie.douban.com/',
      },
      timeout: 10000,
    });
    res.set('Content-Type', response.headers['content-type']);
    res.set('Cache-Control', 'public, max-age=86400');
    response.data.pipe(res);
  } catch (e) {
    res.status(500).send('Proxy error');
  }
});

app.get('/api/network/info', (req, res) => {
  const localIP = getLocalIP();
  res.json({
    success: true,
    data: {
      localUrl: `http://localhost:${PORT}`,
      networkUrl: `http://${localIP}:${PORT}`
    }
  });
});

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

app.use((err, req, res, next) => {
  logger.error('Express error:', err);
  res.status(500).json({ success: false, message: '服务器内部错误' });
});

const HOST = '0.0.0.0';
const localIP = getLocalIP();

app.listen(PORT, HOST, () => {
  console.log(`Movie Archive Server v${VERSION} running at:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}`);
  console.log('');
  // 后台海报获取任务已禁用自动启动
  // 如需启动，请调用 POST /api/background/start
  console.log('提示: 后台海报获取任务已禁用自动启动');
  console.log('      如需启动，请调用 POST /api/background/start');
});
