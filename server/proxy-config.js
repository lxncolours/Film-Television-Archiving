const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');

const CONFIG_PATH = path.join(__dirname, '..', 'proxy_config.json');

const AGENT = new https.Agent({ rejectUnauthorized: process.env.NODE_ENV === 'production' });

let proxyConfig = null;

function loadConfig() {
  if (proxyConfig) return proxyConfig;

  const defaultConfig = {
    enabled: true,
    host: '127.0.0.1',
    port: 6789,
    protocol: 'http',
  };

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (saved && saved.host) {
        proxyConfig = { ...defaultConfig, ...saved };
        return proxyConfig;
      }
    }
  } catch (e) {
    // ignore
  }

  if (process.env.HTTPS_PROXY) {
    try {
      const parsed = new URL(process.env.HTTPS_PROXY);
      proxyConfig = {
        enabled: true,
        host: parsed.hostname,
        port: parseInt(parsed.port) || 6789,
        protocol: parsed.protocol.replace(':', ''),
      };
      return proxyConfig;
    } catch {}
  } else if (process.env.HTTP_PROXY) {
    try {
      const parsed = new URL(process.env.HTTP_PROXY);
      proxyConfig = {
        enabled: true,
        host: parsed.hostname,
        port: parseInt(parsed.port) || 6789,
        protocol: parsed.protocol.replace(':', ''),
      };
      return proxyConfig;
    } catch {}
  }

  proxyConfig = { ...defaultConfig };
  return proxyConfig;
}

function saveConfig(config) {
  proxyConfig = { ...config };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(proxyConfig, null, 2));
  } catch (e) {
    // ignore
  }
}

function getConfig() {
  return { ...loadConfig() };
}

function setConfig(config) {
  saveConfig(config);
}

function createAxiosInstance(extraOptions = {}) {
  const cfg = loadConfig();
  const options = {
    timeout: 15000,
    httpsAgent: AGENT,
    ...extraOptions,
  };

  if (cfg.enabled && cfg.host) {
    options.proxy = {
      host: cfg.host,
      port: cfg.port || 6789,
      protocol: cfg.protocol || 'http',
    };
  }

  return axios.create(options);
}

function getProxyUrl() {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.host) return '';
  return `${cfg.protocol || 'http'}://${cfg.host}:${cfg.port || 6789}`;
}

module.exports = { getConfig, setConfig, createAxiosInstance, getProxyUrl, loadConfig };
