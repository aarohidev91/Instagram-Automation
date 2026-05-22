const fs = require('fs');
const path = require('path');
const utilities = require('./utils');

/**
 * Sliding-window rate limiter that persists state to disk.
 * Tracks every API / posting action and enforces configurable
 * per-minute, per-hour and per-day ceilings so Instagram never
 * sees burst traffic from this bot.
 */
class RateLimiter {
  constructor(options = {}) {
    this.limits = {
      postsPerDay: options.postsPerDay || 5,
      postsPerHour: options.postsPerHour || 1,
      actionsPerMinute: options.actionsPerMinute || 10,
      actionsPerHour: options.actionsPerHour || 60,
      minPostInterval: options.minPostInterval || 30 * 60 * 1000, // 30 min
      maxPostInterval: options.maxPostInterval || 120 * 60 * 1000, // 2 hours
    };

    this.dataDir = options.dataDir || path.join(process.cwd(), 'data');
    this.statePath = path.join(this.dataDir, 'rate-limiter.json');
    this.state = this._load();
  }

  /* ------------------------------------------------------------------ */
  /*  Persistence                                                        */
  /* ------------------------------------------------------------------ */

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
      /* corrupted file – start fresh */
    }
    return { posts: [], actions: [], cooldownUntil: 0 };
  }

  _save() {
    this._ensureDir();
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  _prune(arr, windowMs) {
    const cutoff = Date.now() - windowMs;
    return arr.filter((t) => t > cutoff);
  }

  _countInWindow(arr, windowMs) {
    const cutoff = Date.now() - windowMs;
    return arr.filter((t) => t > cutoff).length;
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  /** Record a generic action (API call, page load, etc.) */
  recordAction() {
    this.state.actions.push(Date.now());
    this.state.actions = this._prune(this.state.actions, 60 * 60 * 1000);
    this._save();
  }

  /** Record that a post was published */
  recordPost() {
    this.state.posts.push(Date.now());
    this.state.posts = this._prune(this.state.posts, 24 * 60 * 60 * 1000);
    this.recordAction();
    this._save();
  }

  /** Activate a manual cooldown (e.g. after a rate-limit response) */
  setCooldown(durationMs) {
    this.state.cooldownUntil = Date.now() + durationMs;
    this._save();
    utilities.logToFile(
      `Rate limiter: cooldown set for ${Math.round(durationMs / 60000)} min`
    );
  }

  /** Can we perform a generic action right now? */
  canAct() {
    if (Date.now() < this.state.cooldownUntil) {
      return {
        allowed: false,
        reason: 'cooldown',
        retryAfter: this.state.cooldownUntil - Date.now(),
      };
    }
    const perMin = this._countInWindow(this.state.actions, 60 * 1000);
    if (perMin >= this.limits.actionsPerMinute) {
      return {
        allowed: false,
        reason: 'actions_per_minute',
        retryAfter: 60 * 1000,
      };
    }
    const perHour = this._countInWindow(this.state.actions, 60 * 60 * 1000);
    if (perHour >= this.limits.actionsPerHour) {
      return {
        allowed: false,
        reason: 'actions_per_hour',
        retryAfter: 60 * 60 * 1000,
      };
    }
    return { allowed: true };
  }

  /** Can we publish a post right now? */
  canPost() {
    const actCheck = this.canAct();
    if (!actCheck.allowed) return actCheck;

    const postsToday = this._countInWindow(
      this.state.posts,
      24 * 60 * 60 * 1000
    );
    if (postsToday >= this.limits.postsPerDay) {
      return {
        allowed: false,
        reason: 'daily_limit',
        retryAfter: this._msUntilMidnight(),
      };
    }

    const postsHour = this._countInWindow(
      this.state.posts,
      60 * 60 * 1000
    );
    if (postsHour >= this.limits.postsPerHour) {
      return {
        allowed: false,
        reason: 'hourly_limit',
        retryAfter: 60 * 60 * 1000,
      };
    }

    const lastPost =
      this.state.posts.length > 0
        ? this.state.posts[this.state.posts.length - 1]
        : 0;
    const elapsed = Date.now() - lastPost;
    if (elapsed < this.limits.minPostInterval) {
      return {
        allowed: false,
        reason: 'min_interval',
        retryAfter: this.limits.minPostInterval - elapsed,
      };
    }

    return { allowed: true };
  }

  /** Wait until the rate limiter allows posting */
  async waitForPostSlot() {
    let check = this.canPost();
    while (!check.allowed) {
      const waitMs = Math.min(check.retryAfter + 5000, 60 * 60 * 1000);
      utilities.logToFile(
        `Rate limiter: waiting ${Math.round(waitMs / 60000)} min (${check.reason})`
      );
      await utilities.delay(waitMs);
      check = this.canPost();
    }
  }

  /** Generate a random delay that feels human */
  getRandomPostDelay() {
    const { minPostInterval, maxPostInterval } = this.limits;
    return (
      minPostInterval + Math.random() * (maxPostInterval - minPostInterval)
    );
  }

  /** Snapshot for the dashboard */
  getStats() {
    return {
      postsToday: this._countInWindow(this.state.posts, 24 * 60 * 60 * 1000),
      postsThisHour: this._countInWindow(this.state.posts, 60 * 60 * 1000),
      actionsThisMinute: this._countInWindow(this.state.actions, 60 * 1000),
      actionsThisHour: this._countInWindow(
        this.state.actions,
        60 * 60 * 1000
      ),
      cooldownActive: Date.now() < this.state.cooldownUntil,
      cooldownRemaining: Math.max(0, this.state.cooldownUntil - Date.now()),
      limits: { ...this.limits },
    };
  }

  /** Update limits at runtime (e.g. from dashboard) */
  updateLimits(newLimits) {
    Object.assign(this.limits, newLimits);
    this._save();
  }

  _msUntilMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight - now;
  }
}

module.exports = RateLimiter;
