const fs = require('fs');
const path = require('path');
const utilities = require('./utils');

/**
 * AccountGuard – keeps the Instagram account alive by mimicking
 * human behaviour patterns and backing off when risk signals appear.
 *
 * Key strategies:
 * 1. Only post during "human" hours (configurable window).
 * 2. Warm-up newly-connected accounts with slowly increasing activity.
 * 3. Random jitter on every delay so the bot never looks like a cron job.
 * 4. Track consecutive errors and enter "safe mode" automatically.
 * 5. Respect Instagram's known thresholds (posts/day, actions/hour).
 */
class AccountGuard {
  constructor(options = {}) {
    this.config = {
      activeHoursStart: options.activeHoursStart ?? 9,
      activeHoursEnd: options.activeHoursEnd ?? 23,
      timezone: options.timezone || 'Asia/Kolkata',
      warmUpDays: options.warmUpDays ?? 7,
      maxConsecutiveErrors: options.maxConsecutiveErrors ?? 3,
      safeModeHours: options.safeModeHours ?? 6,
      enableWeekendPause: options.enableWeekendPause ?? false,
      weekendMaxPosts: options.weekendMaxPosts ?? 2,
    };

    this.dataDir = options.dataDir || path.join(process.cwd(), 'data');
    this.statePath = path.join(this.dataDir, 'account-guard.json');
    this.state = this._load();
  }

  /* ----- persistence ------------------------------------------------ */

  _ensureDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  _load() {
    try {
      if (fs.existsSync(this.statePath)) {
        return JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      }
    } catch {
      /* corrupted – start fresh */
    }
    return {
      firstRunDate: new Date().toISOString(),
      consecutiveErrors: 0,
      safeModeUntil: 0,
      totalPosts: 0,
      lastPostTime: 0,
      checkpointCount: 0,
      dailyPostHistory: {},
    };
  }

  _save() {
    this._ensureDir();
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  /* ----- time helpers ----------------------------------------------- */

  _nowInTimezone() {
    const str = new Date().toLocaleString('en-US', {
      timeZone: this.config.timezone,
    });
    return new Date(str);
  }

  _isWeekend() {
    const day = this._nowInTimezone().getDay();
    return day === 0 || day === 6;
  }

  _isActiveHour() {
    const hour = this._nowInTimezone().getHours();
    return (
      hour >= this.config.activeHoursStart &&
      hour < this.config.activeHoursEnd
    );
  }

  /* ----- warm-up ---------------------------------------------------- */

  _daysSinceFirstRun() {
    const first = new Date(this.state.firstRunDate);
    return Math.floor((Date.now() - first.getTime()) / (24 * 60 * 60 * 1000));
  }

  getWarmUpMultiplier() {
    const days = this._daysSinceFirstRun();
    if (days >= this.config.warmUpDays) return 1;
    return Math.max(0.2, days / this.config.warmUpDays);
  }

  /* ----- error tracking --------------------------------------------- */

  recordError(errorMsg) {
    this.state.consecutiveErrors += 1;

    if (errorMsg && errorMsg.toLowerCase().includes('checkpoint')) {
      this.state.checkpointCount += 1;
      this.enterSafeMode(12);
      utilities.logToFile(
        'AccountGuard: CHECKPOINT detected – entering 12 h safe mode'
      );
    } else if (
      this.state.consecutiveErrors >= this.config.maxConsecutiveErrors
    ) {
      this.enterSafeMode(this.config.safeModeHours);
      utilities.logToFile(
        `AccountGuard: ${this.state.consecutiveErrors} consecutive errors – safe mode for ${this.config.safeModeHours} h`
      );
    }
    this._save();
  }

  recordSuccess() {
    this.state.consecutiveErrors = 0;
    this.state.totalPosts += 1;
    this.state.lastPostTime = Date.now();

    const today = new Date().toISOString().slice(0, 10);
    this.state.dailyPostHistory[today] =
      (this.state.dailyPostHistory[today] || 0) + 1;

    // keep only the last 90 days
    const keys = Object.keys(this.state.dailyPostHistory).sort();
    while (keys.length > 90) {
      delete this.state.dailyPostHistory[keys.shift()];
    }
    this._save();
  }

  enterSafeMode(hours) {
    this.state.safeModeUntil = Date.now() + hours * 60 * 60 * 1000;
    this._save();
  }

  clearSafeMode() {
    this.state.safeModeUntil = 0;
    this.state.consecutiveErrors = 0;
    this._save();
    utilities.logToFile('AccountGuard: safe mode cleared manually');
  }

  /* ----- main gate -------------------------------------------------- */

  /**
   * Returns { allowed, reason, retryAfter } describing whether the bot
   * should attempt a post right now.
   */
  canPost() {
    // safe-mode check
    if (Date.now() < this.state.safeModeUntil) {
      return {
        allowed: false,
        reason: 'safe_mode',
        retryAfter: this.state.safeModeUntil - Date.now(),
      };
    }

    // active-hours check
    if (!this._isActiveHour()) {
      return {
        allowed: false,
        reason: 'outside_active_hours',
        retryAfter: this._msUntilActiveHours(),
      };
    }

    // weekend throttle
    if (this.config.enableWeekendPause && this._isWeekend()) {
      const today = new Date().toISOString().slice(0, 10);
      const todayPosts = this.state.dailyPostHistory[today] || 0;
      if (todayPosts >= this.config.weekendMaxPosts) {
        return {
          allowed: false,
          reason: 'weekend_limit',
          retryAfter: this._msUntilMidnight(),
        };
      }
    }

    return { allowed: true };
  }

  /** Block until it's safe to post */
  async waitForSafeWindow() {
    let check = this.canPost();
    while (!check.allowed) {
      const jitter = Math.random() * 5 * 60 * 1000; // 0-5 min jitter
      const waitMs = Math.min(check.retryAfter + jitter, 8 * 60 * 60 * 1000);
      utilities.logToFile(
        `AccountGuard: waiting ${Math.round(waitMs / 60000)} min (${check.reason})`
      );
      await utilities.delay(waitMs);
      check = this.canPost();
    }
  }

  /** Human-like random delay with jitter */
  async humanDelay(baseMs = 5000) {
    const jitter = baseMs * 0.3 * (Math.random() - 0.5);
    const delay = Math.max(1000, baseMs + jitter);
    await utilities.delay(delay);
  }

  /* ----- dashboard stats -------------------------------------------- */

  getStats() {
    return {
      daysSinceFirstRun: this._daysSinceFirstRun(),
      warmUpMultiplier: this.getWarmUpMultiplier(),
      consecutiveErrors: this.state.consecutiveErrors,
      safeModeActive: Date.now() < this.state.safeModeUntil,
      safeModeRemaining: Math.max(
        0,
        this.state.safeModeUntil - Date.now()
      ),
      totalPosts: this.state.totalPosts,
      lastPostTime: this.state.lastPostTime,
      checkpointCount: this.state.checkpointCount,
      isActiveHour: this._isActiveHour(),
      isWeekend: this._isWeekend(),
      dailyPostHistory: { ...this.state.dailyPostHistory },
    };
  }

  /** Update config at runtime (e.g. from dashboard) */
  updateConfig(newConfig) {
    const keys = [
      'activeHoursStart', 'activeHoursEnd', 'enableWeekendPause',
      'weekendMaxPosts', 'warmUpDays', 'safeModeHours',
      'maxConsecutiveErrors', 'timezone',
    ];
    for (const key of keys) {
      if (newConfig[key] !== undefined) this.config[key] = newConfig[key];
    }
  }

  /* ----- helpers ---------------------------------------------------- */

  _msUntilActiveHours() {
    const now = this._nowInTimezone();
    const hour = now.getHours();
    const minuteMs = now.getMinutes() * 60 * 1000 + now.getSeconds() * 1000;
    if (hour < this.config.activeHoursStart) {
      return (this.config.activeHoursStart - hour) * 60 * 60 * 1000 - minuteMs;
    }
    // past active hours → wait until next day
    return (24 - hour + this.config.activeHoursStart) * 60 * 60 * 1000 - minuteMs;
  }

  _msUntilMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight - now;
  }
}

module.exports = AccountGuard;
