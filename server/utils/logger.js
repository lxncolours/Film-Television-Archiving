const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const levels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

function shouldLog(level) {
  return levels[level] >= levels[LOG_LEVEL];
}

function log(level, ...args) {
  if (shouldLog(level)) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timestamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    console[level](`[${timestamp}] [${level.toUpperCase()}]`, ...args);
  }
}

module.exports = {
  debug: (...args) => log('debug', ...args),
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
  log: console.log.bind(console)
};
