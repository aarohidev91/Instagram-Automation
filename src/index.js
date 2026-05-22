require('dotenv').config();
const MemeBotCore = require('./bot');
const ConfigManager = require('./config');
const createServer = require('./server');
const KeepAlive = require('./keep-alive');
const utilities = require('./utils');

/**
 * Main entry point – wires up the bot, GUI server, and keep-alive.
 */
class InstagramMemeBot {
  constructor() {
    this.config = new ConfigManager();
    this.bot = null;
    this.server = null;
    this.keepAlive = null;
  }

  _ensureBot() {
    if (!this.bot) this.bot = new MemeBotCore();
  }

  /** Run a single post cycle */
  async runOnce() {
    this._validate();
    this._ensureBot();
    await this.bot.initialize();
    await this.bot.runCycle();
  }

  /** Run continuously (legacy mode – random intervals) */
  async run() {
    this._validate();
    this._ensureBot();
    await this.bot.initialize();
    await this.bot.runContinuous();
  }

  /** Start everything: GUI + scheduler + keep-alive */
  async start() {
    this._validate();
    this._ensureBot();
    const cfg = ConfigManager.getAll();

    // initialise Instagram session
    await this.bot.initialize();

    // start GUI dashboard
    if (cfg.guiEnabled) {
      const app = createServer(this.bot);
      const port = cfg.guiPort;
      this.server = app.listen(port, () => {
        utilities.logToFile(`GUI dashboard running on port ${port}`);
      });
    }

    // start keep-alive pinger
    this.keepAlive = new KeepAlive({
      url: cfg.renderExternalUrl || undefined,
      intervalMinutes: cfg.keepAliveInterval,
    });
    this.keepAlive.start();

    // start scheduler-driven posting
    this.bot.startScheduled();

    // graceful shutdown
    const shutdown = () => {
      utilities.logToFile('Shutting down...');
      this.bot.requestShutdown();
      if (this.keepAlive) this.keepAlive.stop();
      if (this.server) this.server.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /** Start only the GUI dashboard (no posting) */
  async startDashboard() {
    this._validate();
    this._ensureBot();
    const cfg = ConfigManager.getAll();

    const app = createServer(this.bot);
    const port = cfg.guiPort;
    this.server = app.listen(port, () => {
      utilities.logToFile(`Dashboard-only mode on port ${port}`);
    });
  }

  /** Interactive config setup */
  async setupConfig() {
    await this.config.setupConfig();
  }

  _validate() {
    const v = this.config.validateConfig();
    if (!v.valid) throw new Error(v.message);
  }
}

module.exports = InstagramMemeBot;
