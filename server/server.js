const express = require('express');
const cors = require('cors');
const path = require('path');
const logger = require('./utils/logger');
const { loadEnv } = require('./utils/env');

loadEnv();

if (process.platform === 'win32') {
  try { 
    require('child_process').execSync('chcp 65001 > nul'); 
    process.stdout.write('\u001b[?7l');
  } catch {}
}

const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_NAME'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  logger.error('Error: Missing required environment variables:', missingVars.join(', '));
  logger.error('Please check your .env file');
  process.exit(1);
}

const tmdb = require('./tmdb');
const movieRoutes = require('./routes/movies');
const doubanRoutes = require('./routes/douban');
const tmdbRoutes = require('./routes/tmdb');
const cache = require('./redis');
const os = require('os');
const backgroundTasks = require('./background_tasks');
const proxyConfig = require('./proxy-config');

const app = express();
const PORT = process.env.PORT || 5280;
const VERSION = process.env.APP_VERSION || require('../package.json').version;

let proxyAxios; // will be initialized in startServer

// CORS: default same-origin only; set CORS_ORIGINS env for cross-origin access
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const corsOptions = {
  origin: ALLOWED_ORIGINS.length > 0
    ? (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) callback(null, true);
        else callback(null, false);
      }
    : false,
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ type: 'application/json', limit: '300mb' }));
app.use(express.urlencoded({ extended: true, limit: '300mb' }));

app.disable('etag');

// Block access to server-side code and sensitive files
const BLOCKED_PATHS = ['/server/', '/package.json', '/package-lock.json', '/Dockerfile', '/docker-compose.yml', '/docker-entrypoint.sh', '/.env', '/.github/', '/.gitignore', '/.githooks/', '/.workbuddy/', '/node_modules/'];
app.use((req, res, next) => {
  if (BLOCKED_PATHS.some(p => req.path === p || req.path.startsWith(p))) {
    return res.status(403).send('Forbidden');
  }
  next();
});

// Simple in-memory rate limiter (no external dependency)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 200;
app.use('/api/', (req, res, next) => {
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const now = Date.now();
  let record = rateLimitMap.get(ip);
  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + RATE_LIMIT_WINDOW };
    rateLimitMap.set(ip, record);
    next();
  } else if (record.count >= RATE_LIMIT_MAX) {
    res.set('Retry-After', String(Math.ceil((record.resetTime - now) / 1000)));
    res.status(429).json({ success: false, message: '请求过于频繁，请稍后再试' });
  } else {
    record.count++;
    next();
  }
});
// Periodic cleanup of stale rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap) {
    if (now > record.resetTime) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000).unref();

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
  }
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

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const ip = req.headers['x-forwarded-for'] || req.ip;
    logger.info(`${ip} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get('/api/health', (req, res) => {
  logger.info(`[Health] entry - ${req.ip}`);
  res.json({ status: 'ok', version: VERSION });
});

app.use('/api/movies', movieRoutes);
app.use('/api/douban', doubanRoutes);
app.use('/api/tmdb', tmdbRoutes);

app.get('/api/background/status', (req, res) => {
  res.json({ success: true, data: backgroundTasks.getStats() });
});

app.post('/api/background/start', (req, res) => {
  logger.info(`[Background] start - entry`);
  backgroundTasks.start();
  res.json({ success: true, message: '后台任务已启动' });
});

app.post('/api/background/stop', (req, res) => {
  logger.info(`[Background] stop - entry`);
  backgroundTasks.stop();
  res.json({ success: true, message: '后台任务已停止' });
});

app.get('/api/proxy/config', async (req, res) => {
  logger.info(`[Proxy] GET /config - entry`);
  const data = await proxyConfig.getConfig();
  logger.info(`[Proxy] GET /config - exit`);
  res.json({ success: true, data });
});

app.put('/api/proxy/config', async (req, res) => {
  logger.info(`[Proxy] PUT /config - entry`);
  const current = await proxyConfig.getConfig();
  const { enabled, host, port, protocol } = req.body;
  const newConfig = {
    enabled: enabled !== undefined ? enabled : current.enabled,
    host: host !== undefined ? host : current.host,
    port: port !== undefined ? port : current.port,
    protocol: protocol !== undefined ? protocol : current.protocol,
  };
  logger.info(`[Proxy Route] PUT /config - newConfig: ${JSON.stringify(newConfig)}`);
  try {
    await proxyConfig.setConfig(newConfig);
    proxyAxios = proxyConfig.createAxiosInstance();
    tmdb.refreshClient();
    logger.info('[Proxy Route] setConfig succeeded, sending success response');
    res.json({ success: true, data: await proxyConfig.getConfig(), message: '代理配置已更新' });
  } catch (e) {
    logger.error(`[Proxy Route] setConfig failed: ${e.message}`);
    logger.error(`[Proxy Route] Stack: ${e.stack}`);
    res.status(500).json({ success: false, message: '保存失败: ' + e.message });
  }
});

// SSRF protection: only allow known image domains
const ALLOWED_IMAGE_DOMAINS = [
  'image.tmdb.org',
  'doubanio.com',
  'douban.com',
  'img1.doubanio.com', 'img2.doubanio.com', 'img3.doubanio.com',
  'img9.doubanio.com', 'imglf.doubanio.com', 'img3.doubanio.com',
];

function isAllowedImageUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Invalid url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Invalid protocol' };
  }
  const hostname = parsed.hostname.toLowerCase();
  const isAllowed = ALLOWED_IMAGE_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  if (!isAllowed) return { ok: false, reason: 'Domain not allowed' };
  // Block internal/private IPs (defense in depth against DNS rebinding)
  if (hostname === 'localhost' || hostname === '0.0.0.0' ||
      hostname.startsWith('127.') || hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') || hostname.startsWith('169.254.') ||
      hostname.startsWith('172.') || hostname.startsWith('::1') || hostname.startsWith('fc') || hostname.startsWith('fd')) {
    return { ok: false, reason: 'Internal addresses not allowed' };
  }
  return { ok: true };
}

app.get('/api/proxy/image', async (req, res) => {
  const { url } = req.query;
  logger.info(`[Proxy] GET /image - entry url: ${url}`);
  try {
    if (!url) return res.status(400).send('Missing url');
    const decoded = decodeURIComponent(url);
    const check = isAllowedImageUrl(decoded);
    if (!check.ok) {
      logger.warn(`[Proxy] GET /image - blocked: ${check.reason} url=${decoded}`);
      return res.status(403).send('Forbidden');
    }
    const response = await proxyAxios.get(decoded, {
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
    logger.error(`[Proxy] GET /image - error: ${e.message}`);
    res.status(500).send('Proxy error');
  }
});

app.get('/api/network/info', (req, res) => {
  logger.info(`[Network] info - entry`);
  const localIP = getLocalIP();
  res.json({
    success: true,
    data: {
      localUrl: `http://localhost:${PORT}`,
      networkUrl: `http://${localIP}:${PORT}`,
      version: VERSION
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

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
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

console.log(`Movie Archive Server v${VERSION} starting...`);

async function startServer() {
  await proxyConfig.init();
  await tmdb.init();
  proxyAxios = proxyConfig.createAxiosInstance();

  app.listen(PORT, HOST, () => {
    cache.flushMovies().catch(() => {});
    console.log(`Movie Archive Server v${VERSION} running at:`);
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  Network: http://${localIP}:${PORT}`);
    console.log('');
    logger.info('提示: 后台海报获取任务已禁用自动启动');
    logger.info('      如需启动，请调用 POST /api/background/start');
  });
}

startServer().catch(err => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
