const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Centralised, validated configuration for every component.
 * Reads from environment variables (via .env) and exposes typed
 * getters so the rest of the app never has to parse env vars.
 */
class ConfigManager {
  constructor() {
    this.envPath = path.join(process.cwd(), '.env');
  }

  /* ------------------------------------------------------------------ */
  /*  Interactive setup                                                  */
  /* ------------------------------------------------------------------ */

  createInterface() {
    return readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async prompt(question, hidden = false) {
    const rl = this.createInterface();

    return new Promise((resolve) => {
      if (hidden) {
        rl.stdoutMuted = true;
        rl._writeToOutput = function _writeToOutput(stringToWrite) {
          if (rl.stdoutMuted) {
            rl.output.write('*');
          } else {
            rl.output.write(stringToWrite);
          }
        };
      }

      rl.question(question, (answer) => {
        rl.close();
        if (hidden) console.log();
        resolve(answer.trim());
      });
    });
  }

  async setupConfig() {
    console.log('\n--- Instagram Meme Bot Configuration ---\n');

    const config = {};

    // credentials
    config.INSTA_USERNAME = await this.prompt('Instagram Username: ');
    config.INSTA_PASSWORD = await this.prompt('Instagram Password: ', true);

    // scheduling
    config.POSTS_PER_DAY = await this.prompt(
      'Posts per day (default 3): '
    ) || '3';
    config.ACTIVE_HOURS_START = await this.prompt(
      'Active hours start (0-23, default 9): '
    ) || '9';
    config.ACTIVE_HOURS_END = await this.prompt(
      'Active hours end (0-23, default 23): '
    ) || '23';

    // post types
    console.log(
      '\nAvailable post types: funny, hinglish, trending, desi, relatable, programming'
    );
    config.POST_TYPES = await this.prompt(
      'Post types (comma-separated, default funny,hinglish,trending): '
    ) || 'funny,hinglish,trending';

    const guiPort = await this.prompt(
      'GUI dashboard port (default 3000): '
    ) || '3000';
    config.GUI_PORT = guiPort;

    const renderUrl = await this.prompt(
      'Render external URL for keep-alive (Enter to skip): '
    );
    if (renderUrl) config.RENDER_EXTERNAL_URL = renderUrl;

    // write
    const envContent = Object.entries(config)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    fs.writeFileSync(this.envPath, envContent);
    console.log('\nConfiguration saved to .env');
    console.log('Run: npx instagram-meme-bot start');
  }

  /* ------------------------------------------------------------------ */
  /*  Validation                                                         */
  /* ------------------------------------------------------------------ */

  validateConfig() {
    if (!fs.existsSync(this.envPath)) {
      return {
        valid: false,
        message: '.env file not found. Run: npx instagram-meme-bot config',
      };
    }

    require('dotenv').config();

    if (!process.env.INSTA_USERNAME || !process.env.INSTA_PASSWORD) {
      return {
        valid: false,
        message: 'Instagram credentials missing in .env file',
      };
    }

    return { valid: true };
  }

  /* ------------------------------------------------------------------ */
  /*  Typed getters                                                      */
  /* ------------------------------------------------------------------ */

  static get(key, fallback) {
    return process.env[key] || fallback;
  }

  static getInt(key, fallback) {
    const v = process.env[key];
    return v !== undefined ? parseInt(v, 10) : fallback;
  }

  static getBool(key, fallback) {
    const v = process.env[key];
    if (v === undefined) return fallback;
    return v === 'true' || v === '1';
  }

  static getList(key, fallback = []) {
    const v = process.env[key];
    if (!v) return fallback;
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  }

  /** Return a full settings object for the bot */
  static getAll() {
    return {
      // credentials
      username: process.env.INSTA_USERNAME,
      password: process.env.INSTA_PASSWORD,

      // scheduling
      postsPerDay: ConfigManager.getInt('POSTS_PER_DAY', 3),
      activeHoursStart: ConfigManager.getInt('ACTIVE_HOURS_START', 9),
      activeHoursEnd: ConfigManager.getInt('ACTIVE_HOURS_END', 23),
      timezone: ConfigManager.get('TIMEZONE', 'Asia/Kolkata'),

      // post types
      postTypes: ConfigManager.getList('POST_TYPES', [
        'funny',
        'hinglish',
        'trending',
      ]),

      // rate limits
      maxPostsPerDay: ConfigManager.getInt('MAX_POSTS_PER_DAY', 5),
      minPostIntervalMin: ConfigManager.getInt('MIN_POST_INTERVAL_MIN', 30),
      maxPostIntervalMin: ConfigManager.getInt('MAX_POST_INTERVAL_MIN', 120),

      // safety
      warmUpDays: ConfigManager.getInt('WARM_UP_DAYS', 7),
      safeModeHours: ConfigManager.getInt('SAFE_MODE_HOURS', 6),
      enableWeekendPause: ConfigManager.getBool(
        'ENABLE_WEEKEND_PAUSE',
        false
      ),
      weekendMaxPosts: ConfigManager.getInt('WEEKEND_MAX_POSTS', 2),

      // GUI
      guiPort: ConfigManager.getInt('GUI_PORT', 3000),
      guiEnabled: ConfigManager.getBool('GUI_ENABLED', true),

      // keep-alive
      renderExternalUrl: ConfigManager.get('RENDER_EXTERNAL_URL', ''),
      keepAliveInterval: ConfigManager.getInt('KEEP_ALIVE_INTERVAL', 10),
    };
  }
}

module.exports = ConfigManager;
