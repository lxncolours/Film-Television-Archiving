const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const movieRoutes = require('./routes/movies');
const doubanRoutes = require('./routes/douban');
const tmdbRoutes = require('./routes/tmdb');
const os = require('os');
const axios = require('axios');
const backgroundTasks = require('./background_tasks');

const app = express();
const PORT = process.env.PORT || 3000;
const PROXY = { host: '127.0.0.1', port: 6789 };
const AGENT = new https.Agent({ rejectUnauthorized: false });

// Set proxy globally for axios (used by /api/proxy/image and other external calls)
const proxyAxios = axios.create({
  proxy: PROXY,
  httpsAgent: AGENT,
  timeout: 15000,
});

const corsOptions = {
  origin: true,
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// Disable cache for index.html to ensure latest code
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
  }
  next();
});

app.use(express.static(path.join(__dirname, '..')));

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

const HOST = '0.0.0.0';
const localIP = getLocalIP();

app.listen(PORT, HOST, () => {
  console.log(`Movie Archive Server running at:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}`);
  console.log('');
  // 后台海报获取任务已禁用自动启动
  // 如需启动，请调用 POST /api/background/start
  console.log('提示: 后台海报获取任务已禁用自动启动');
  console.log('      如需启动，请调用 POST /api/background/start');
});
