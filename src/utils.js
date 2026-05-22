const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Production-grade utility helpers with structured logging,
 * automatic log rotation, and safe file operations.
 */
const utilities = {
  /**
   * Create a delay for the specified number of milliseconds
   * @param {number} ms
   * @returns {Promise<void>}
   */
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

  /**
   * Human-like random delay (3-8 s by default)
   * @param {number} minMs
   * @param {number} maxMs
   */
  randomDelay: (minMs = 3000, maxMs = 8000) =>
    utilities.delay(minMs + Math.random() * (maxMs - minMs)),

  /**
   * Structured log with automatic rotation.
   * @param {string} message
   * @param {'info'|'warn'|'error'|'debug'} level
   */
  logToFile: (message, level = 'info') => {
    try {
      if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
      }
      const logFile = path.join(LOG_DIR, 'bot.log');

      // rotate if too big
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        if (stats.size > MAX_LOG_SIZE) {
          const rotated = path.join(
            LOG_DIR,
            `bot-${Date.now()}.log`
          );
          fs.renameSync(logFile, rotated);
          // keep only last 5 rotated files
          const old = fs
            .readdirSync(LOG_DIR)
            .filter(
              (f) => f.startsWith('bot-') && f.endsWith('.log')
            )
            .sort();
          while (old.length > 5) {
            fs.unlinkSync(path.join(LOG_DIR, old.shift()));
          }
        }
      }

      const ts = new Date().toISOString();
      const entry = `[${ts}] [${level.toUpperCase()}] ${message}\n`;
      fs.appendFileSync(logFile, entry);
      console.log(`[${level.toUpperCase()}] ${message}`);
    } catch {
      // fallback – never crash because of logging
      console.log(message);
    }
  },

  /**
   * Clean up a temporary file safely.
   * @param {string} filePath
   */
  cleanupFile: (filePath) => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      /* best effort */
    }
  },

  /**
   * Safe JSON read – returns defaultValue on any error.
   */
  readJSON: (filePath, defaultValue = null) => {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return defaultValue;
    }
  },

  /**
   * Safe JSON write
   */
  writeJSON: (filePath, data) => {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  },

  /**
   * Format milliseconds into human-readable string
   */
  formatDuration: (ms) => {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  },

  /**
   * Retry a function with exponential back-off.
   * @param {Function} fn
   * @param {number} maxRetries
   * @param {number} baseDelay  ms
   */
  retry: async (fn, maxRetries = 3, baseDelay = 5000) => {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          const wait =
            baseDelay * Math.pow(2, attempt - 1) +
            Math.random() * 2000;
          utilities.logToFile(
            `Retry ${attempt}/${maxRetries} failed: ${err.message}. Waiting ${Math.round(wait / 1000)}s`,
            'warn'
          );
          await utilities.delay(wait);
        }
      }
    }
    throw lastError;
  },

  /**
   * Validate an image file (exists, > 10 KB, < 10 MB).
   */
  validateImage: (filePath) => {
    if (!fs.existsSync(filePath)) return { valid: false, reason: 'not_found' };
    const stats = fs.statSync(filePath);
    if (stats.size < 10 * 1024)
      return { valid: false, reason: 'too_small' };
    if (stats.size > 10 * 1024 * 1024)
      return { valid: false, reason: 'too_large' };
    return { valid: true };
  },
};

module.exports = utilities;
