const https = require('https');
const axios = require('axios');
const logger = require('./utils/logger');

const AGENT = new https.Agent({ rejectUnauthorized: process.env.NODE_ENV === 'production' });

let proxyConfigCache = null;

const defaultConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 6789,
  protocol: 'http',
};

async function init() {
  try {
    const { getSetting, SETTING_KEYS } = require('./utils/settings');
    const dbValue = await getSetting(SETTING_KEYS.PROXY_CONFIG);
    if (dbValue) {
      try {
        proxyConfigCache = JSON.parse(dbValue);
        return;
      } catch {
        // invalid JSON in DB, ignore
      }
    }
  } catch (e) {
    logger.debug('Proxy init from DB failed:', e.message);
  }
}

async function loadConfig() {
  if (proxyConfigCache) return proxyConfigCache;
  try {
    const { getSetting, SETTING_KEYS } = require('./utils/settings');
    const dbValue = await getSetting(SETTING_KEYS.PROXY_CONFIG);
    if (dbValue) {
      try {
        proxyConfigCache = JSON.parse(dbValue);
        return proxyConfigCache;
      } catch {}
    }
  } catch (e) {
    logger.debug('loadConfig DB fallback failed:', e.message);
  }
  return defaultConfig;
}

function loadConfigSync() {
  return proxyConfigCache || defaultConfig;
}

async function setConfig(config) {
  proxyConfigCache = { ...config };
  try {
    const { setSetting, SETTING_KEYS } = require('./utils/settings');
    await setSetting(SETTING_KEYS.PROXY_CONFIG, JSON.stringify(proxyConfigCache));
  } catch (e) {
    logger.debug('Proxy save to DB failed:', e.message);
  }
}

async function getConfig() {
  return { ...(await loadConfig()) };
}

function createAxiosInstance(extraOptions = {}) {
  const cfg = loadConfigSync();
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
  const cfg = loadConfigSync();
  if (!cfg.enabled || !cfg.host) return '';
  return `${cfg.protocol || 'http'}://${cfg.host}:${cfg.port || 6789}`;
}

module.exports = { getConfig, setConfig, createAxiosInstance, getProxyUrl, loadConfig, loadConfigSync, init };
