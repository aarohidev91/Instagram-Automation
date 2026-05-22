const axios = require('axios');
const fs = require('fs');
const path = require('path');
const utilities = require('./utils');
const { getSafeMeme, getRandomKeyword } = require('./scraper');
const InstagramPoster = require('./instagram');
const RateLimiter = require('./rate-limiter');
const AccountGuard = require('./account-guard');
const PostScheduler = require('./scheduler');
const Analytics = require('./analytics');
const ConfigManager = require('./config');

/**
 * Production-grade bot that orchestrates scraping, posting,
 * rate-limiting, scheduling, and safety checks.
 */
class MemeBotCore {
  constructor() {
    const cfg = ConfigManager.getAll();

    this.instagramPoster = new InstagramPoster();

    this.rateLimiter = new RateLimiter({
      postsPerDay: cfg.maxPostsPerDay,
      minPostInterval: cfg.minPostIntervalMin * 60 * 1000,
      maxPostInterval: cfg.maxPostIntervalMin * 60 * 1000,
    });

    this.accountGuard = new AccountGuard({
      activeHoursStart: cfg.activeHoursStart,
      activeHoursEnd: cfg.activeHoursEnd,
      timezone: cfg.timezone,
      warmUpDays: cfg.warmUpDays,
      safeModeHours: cfg.safeModeHours,
      enableWeekendPause: cfg.enableWeekendPause,
      weekendMaxPosts: cfg.weekendMaxPosts,
    });

    this.scheduler = new PostScheduler({
      postsPerDay: cfg.postsPerDay,
      activeHoursStart: cfg.activeHoursStart,
      activeHoursEnd: cfg.activeHoursEnd,
      timezone: cfg.timezone,
      postTypes: cfg.postTypes,
    });

    this.analytics = new Analytics();

    this._status = 'idle'; // idle | running | paused | error
    this._shutdownRequested = false;
  }

  /* ------------------------------------------------------------------ */
  /*  Lifecycle                                                          */
  /* ------------------------------------------------------------------ */

  async initialize() {
    await this.instagramPoster.initialize();
    this._status = 'running';
    utilities.logToFile('Bot: initialized');
  }

  requestShutdown() {
    this._shutdownRequested = true;
    this._status = 'idle';
    this.scheduler.stop();
    utilities.logToFile('Bot: graceful shutdown requested');
  }

  /* ------------------------------------------------------------------ */
  /*  Single cycle                                                       */
  /* ------------------------------------------------------------------ */

  async runCycle(postType) {
    let tempFile;
    try {
      // 1. Safety gate
      await this.accountGuard.waitForSafeWindow();
      await this.rateLimiter.waitForPostSlot();

      // 2. Pick keyword
      const { keyword, type } = getRandomKeyword(postType);
      utilities.logToFile(`Bot: finding a "${type}" meme...`);
      this.rateLimiter.recordAction();

      // 3. Scrape
      const memeUrl = await getSafeMeme(keyword, type);
      this.rateLimiter.recordAction();

      // 4. Download
      tempFile = path.join(process.cwd(), `meme_${Date.now()}.jpg`);
      await this._downloadImage(memeUrl, tempFile);

      // 5. Human-like pause before posting
      await this.accountGuard.humanDelay(5000);

      // 6. Post
      utilities.logToFile('Bot: posting to Instagram...');
      const result = await this.instagramPoster.postImage(tempFile);

      // 7. Record success
      this.rateLimiter.recordPost();
      this.accountGuard.recordSuccess();
      this.analytics.recordPost({
        postType: type,
        keyword: decodeURIComponent(keyword),
        memeUrl,
        caption: result.caption,
      });

      utilities.logToFile('Bot: cycle complete!');
      return { success: true, type };
    } catch (error) {
      utilities.logToFile(`Bot: cycle error – ${error.message}`, 'error');
      this.accountGuard.recordError(error.message);
      this.analytics.recordError(error);

      // rate-limit response from Instagram
      if (
        error.message.includes('rate limit') ||
        error.message.includes('too many')
      ) {
        const cooldown = (1 + Math.random() * 2) * 60 * 60 * 1000;
        this.rateLimiter.setCooldown(cooldown);
      }

      throw error;
    } finally {
      utilities.cleanupFile(tempFile);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Immediate post (dashboard) – bypasses safety gates                  */
  /* ------------------------------------------------------------------ */

  async runCycleImmediate(keyword, postType) {
    let tempFile;
    try {
      const { keyword: kw, type } = keyword
        ? { keyword, type: postType || 'funny' }
        : getRandomKeyword(postType);

      utilities.logToFile(`Bot: immediate post – keyword="${kw}" type="${type}"`);
      const memeUrl = await getSafeMeme(kw, type);
      tempFile = path.join(process.cwd(), `meme_${Date.now()}.jpg`);
      await this._downloadImage(memeUrl, tempFile);
      utilities.logToFile('Bot: posting to Instagram (immediate)...');
      const result = await this.instagramPoster.postImage(tempFile);
      this.rateLimiter.recordPost();
      this.accountGuard.recordSuccess();
      this.analytics.recordPost({
        postType: type,
        keyword: kw,
        memeUrl,
        caption: result.caption,
      });
      utilities.logToFile('Bot: immediate post complete!');
      return { success: true, type, keyword: kw };
    } catch (error) {
      utilities.logToFile(`Bot: immediate post error – ${error.message}`, 'error');
      this.analytics.recordError(error);
      throw error;
    } finally {
      utilities.cleanupFile(tempFile);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Continuous mode                                                     */
  /* ------------------------------------------------------------------ */

  async runContinuous() {
    utilities.logToFile('Bot: starting continuous mode');
    this._status = 'running';

    while (!this._shutdownRequested) {
      try {
        await this.runCycle();

        const delay = this.rateLimiter.getRandomPostDelay();
        utilities.logToFile(
          `Bot: next post in ~${utilities.formatDuration(delay)}`
        );
        await utilities.delay(delay);
      } catch (error) {
        utilities.logToFile(`Bot: error in loop – ${error.message}`, 'error');
        this._status = 'error';
        const backoff = 30 * 60 * 1000 + Math.random() * 30 * 60 * 1000;
        utilities.logToFile(
          `Bot: backing off for ${utilities.formatDuration(backoff)}`
        );
        await utilities.delay(backoff);
        this._status = 'running';
      }
    }
  }

  /**
   * Scheduler-driven mode – the PostScheduler triggers runCycle()
   * at its computed time-slots.
   */
  startScheduled() {
    utilities.logToFile('Bot: starting scheduled mode');
    this._status = 'running';

    this.scheduler.start(async (postType) => {
      if (this._shutdownRequested) return;
      try {
        await this.runCycle(postType);
      } catch (err) {
        utilities.logToFile(
          `Bot: scheduled post failed – ${err.message}`,
          'error'
        );
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  async _downloadImage(url, filepath) {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: 30000,
    });

    return new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(filepath);
      response.data.pipe(stream);
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Dashboard getters                                                  */
  /* ------------------------------------------------------------------ */

  getStatus() {
    return {
      status: this._status,
      rateLimiter: this.rateLimiter.getStats(),
      accountGuard: this.accountGuard.getStats(),
      scheduler: this.scheduler.getSchedule(),
      analytics: this.analytics.getOverview(),
    };
  }
}

module.exports = MemeBotCore;
