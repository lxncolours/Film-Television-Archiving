const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');
const logger = require('./utils/logger');

const CONFIG_PATH = path.join(__dirname, '..', 'proxy_config.json');

const AGENT = new https.Agent({ rejectUnauthorized: process.env.NODE_ENV === 'production' });

let proxyConfigCache = null;

const defaultConfig = {
  enabled: true,
  host: '127.0.0.1',
  port: 6789,
  protocol: 'http',
};

function loadFromFile() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (saved && saved.host) {
        return { ...defaultConfig, ...saved };
      }
    }
  } catch (e) {
    // ignore
  }

  if (process.env.HTTPS_PROXY) {
    try {
      const parsed = new URL(process.env.HTTPS_PROXY);
      return {
        enabled: true,
        host: parsed.hostname,
        port: parseInt(parsed.port) || 6789,
        protocol: parsed.protocol.replace(':', ''),
      };
    } catch {}
  } else if (process.env.HTTP_PROXY) {
    try {
      const parsed = new URL(process.env.HTTP_PROXY);
      return {
        enabled: true,
        host: parsed.hostname,
        port: parseInt(parsed.port) || 6789,
        protocol: parsed.protocol.replace(':', ''),
      };
    } catch {}
  }

  return { ...defaultConfig };
}

async function init() {
  try {
    const { getSetting, setSetting, SETTING_KEYS } = require('./utils/settings');
    const dbValue = await getSetting(SETTING_KEYS.PROXY_CONFIG);

    if (dbValue) {
      try {
        proxyConfigCache = JSON.parse(dbValue);
        return;
      } catch {
        // invalid JSON in DB, fall through
      }
    }

    const fileConfig = loadFromFile();
    const isDefault = fileConfig.host === defaultConfig.host && fileConfig.port === defaultConfig.port;
    if (!isDefault || process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
      await setSetting(SETTING_KEYS.PROXY_CONFIG, JSON.stringify(fileConfig));
      try { fs.unlinkSync(CONFIG_PATH); } catch {}
      logger.info('Proxy config migrated from file to database');
    }
    proxyConfigCache = fileConfig;
  } catch (e) {
    logger.debug('Proxy init from DB failed, falling back to file/env:', e.message);
    proxyConfigCache = loadFromFile();
  }
}

function loadConfig() {
  if (proxyConfigCache) return proxyConfigCache;
  proxyConfigCache = loadFromFile();
  return proxyConfigCache;
}

async function setConfig(config) {
  proxyConfigCache = { ...config };
  try {
    const { setSetting, SETTING_KEYS } = require('./utils/settings');
    await setSetting(SETTING_KEYS.PROXY_CONFIG, JSON.stringify(proxyConfigCache));
  } catch (e) {
    logger.debug('Proxy save to DB failed, falling back to file:', e.message);
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(proxyConfigCache, null, 2));
    } catch {}
  }
}

function getConfig() {
  return { ...loadConfig() };
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

module.exports = { getConfig, setConfig, createAxiosInstance, getProxyUrl, loadConfig, init };
