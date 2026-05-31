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
process.stdout.setEncoding('utf-8');
process.stderr.setEncoding('utf-8');

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

const corsOptions = {
  origin: true,
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ type: 'application/json', limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: VERSION });
});

app.use('/api/movies', movieRoutes);
app.use('/api/douban', doubanRoutes);
app.use('/api/tmdb', tmdbRoutes);

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

app.get('/api/proxy/config', async (req, res) => {
  res.json({ success: true, data: await proxyConfig.getConfig() });
});

app.put('/api/proxy/config', async (req, res) => {
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
    logger.info('[Proxy Route] setConfig succeeded, sending success response');
    res.json({ success: true, data: await proxyConfig.getConfig(), message: '代理配置已更新' });
  } catch (e) {
    logger.error(`[Proxy Route] setConfig failed: ${e.message}`);
    logger.error(`[Proxy Route] Stack: ${e.stack}`);
    res.status(500).json({ success: false, message: '保存失败: ' + e.message });
  }
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
    console.log('提示: 后台海报获取任务已禁用自动启动');
    console.log('      如需启动，请调用 POST /api/background/start');
  });
}

startServer().catch(err => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
