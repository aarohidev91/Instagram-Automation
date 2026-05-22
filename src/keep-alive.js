const http = require('http');
const https = require('https');
const utilities = require('./utils');

/**
 * KeepAlive – pings the app's own URL every N minutes so that
 * free-tier hosts like Render don't spin the service down.
 */
class KeepAlive {
  constructor(options = {}) {
    this.url = options.url || process.env.RENDER_EXTERNAL_URL || null;
    this.intervalMinutes = options.intervalMinutes || 10;
    this._timer = null;
  }

  start() {
    if (!this.url) {
      utilities.logToFile(
        'KeepAlive: no URL configured (set RENDER_EXTERNAL_URL). Skipping.'
      );
      return;
    }

    utilities.logToFile(
      `KeepAlive: pinging ${this.url} every ${this.intervalMinutes} min`
    );

    this._ping(); // first ping immediately
    this._timer = setInterval(
      () => this._ping(),
      this.intervalMinutes * 60 * 1000
    );
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _ping() {
    const lib = this.url.startsWith('https') ? https : http;
    lib
      .get(this.url + '/health', (res) => {
        utilities.logToFile(
          `KeepAlive: ping OK (${res.statusCode})`
        );
        res.resume(); // drain
      })
      .on('error', (err) => {
        utilities.logToFile(`KeepAlive: ping failed – ${err.message}`);
      });
  }

  getStatus() {
    return {
      url: this.url,
      intervalMinutes: this.intervalMinutes,
      active: this._timer !== null,
    };
  }
}

module.exports = KeepAlive;
