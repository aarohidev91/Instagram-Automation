const cron = require('node-cron');
const utilities = require('./utils');

/**
 * PostScheduler – distributes posts evenly throughout the active window
 * using randomised time slots, ensuring the bot never posts at
 * predictable intervals.
 */
class PostScheduler {
  constructor(options = {}) {
    this.postsPerDay = options.postsPerDay || 3;
    this.activeHoursStart = options.activeHoursStart ?? 9;
    this.activeHoursEnd = options.activeHoursEnd ?? 23;
    this.timezone = options.timezone || 'Asia/Kolkata';
    this.postTypes = options.postTypes || ['funny', 'hinglish', 'trending'];
    this.postTypeWeights = options.postTypeWeights || {};
    this.onPostDue = null; // callback
    this._scheduledSlots = [];
    this._cronJob = null;
    this._running = false;
  }

  /**
   * Generate random posting time-slots for today, spread across the
   * active window with jitter.
   */
  generateDailySlots() {
    const windowHours = this.activeHoursEnd - this.activeHoursStart;
    if (windowHours <= 0) return [];

    // get current time in configured timezone
    let currentHour = 0;
    let currentMinute = 0;
    try {
      const nowStr = new Date().toLocaleString('en-US', {
        timeZone: this.timezone,
      });
      const nowTz = new Date(nowStr);
      currentHour = nowTz.getHours();
      currentMinute = nowTz.getMinutes();
    } catch {
      const now = new Date();
      currentHour = now.getHours();
      currentMinute = now.getMinutes();
    }
    const currentTimeMin = currentHour * 60 + currentMinute;

    const slots = [];
    const slotSize = windowHours / this.postsPerDay;

    for (let i = 0; i < this.postsPerDay; i++) {
      const baseHour = this.activeHoursStart + i * slotSize;
      const jitter = Math.random() * slotSize * 0.8;
      const hour = baseHour + jitter;
      const hourInt = Math.floor(hour);
      const minute = Math.floor((hour - hourInt) * 60);
      const slotTimeMin = hourInt * 60 + minute;
      // only include future slots
      if (slotTimeMin > currentTimeMin) {
        slots.push({ hour: hourInt, minute, postType: this._pickPostType() });
      }
    }

    // if no future slots, generate at least one soon
    if (!slots.length && currentHour < this.activeHoursEnd) {
      const soonMinute = currentMinute + 5 + Math.floor(Math.random() * 25);
      const soonHour = currentHour + Math.floor(soonMinute / 60);
      if (soonHour < this.activeHoursEnd) {
        slots.push({
          hour: soonHour,
          minute: soonMinute % 60,
          postType: this._pickPostType(),
        });
      }
    }

    this._scheduledSlots = slots;
    utilities.logToFile(
      `Scheduler: generated ${slots.length} slots for today: ${JSON.stringify(slots)}`
    );
    return slots;
  }

  /**
   * Pick a post type based on configured weights.
   */
  _pickPostType() {
    const types = this.postTypes;
    if (!types.length) return 'funny';

    const weights = types.map(
      (t) => this.postTypeWeights[t] || 1
    );
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalWeight;
    for (let i = 0; i < types.length; i++) {
      r -= weights[i];
      if (r <= 0) return types[i];
    }
    return types[types.length - 1];
  }

  /**
   * Start the scheduler.  A cron job fires every minute and checks
   * whether a slot is due.  Slots are regenerated at midnight.
   */
  start(callback) {
    if (this._running) return;
    this.onPostDue = callback;
    this._running = true;

    this.generateDailySlots();
    this._startCronJobs();

    utilities.logToFile('Scheduler: started');
  }

  _startCronJobs() {
    this._stopCronJobs();

    this._cronJob = cron.schedule(
      '* * * * *',
      () => this._tick(),
      { timezone: this.timezone }
    );

    this._midnightJob = cron.schedule(
      '0 0 * * *',
      () => {
        utilities.logToFile('Scheduler: midnight – regenerating slots');
        this.generateDailySlots();
      },
      { timezone: this.timezone }
    );
  }

  _stopCronJobs() {
    if (this._cronJob) this._cronJob.stop();
    if (this._midnightJob) this._midnightJob.stop();
  }

  stop() {
    this._running = false;
    this._stopCronJobs();
    utilities.logToFile('Scheduler: stopped');
  }

  _tick() {
    if (!this._running || !this.onPostDue) return;

    const now = new Date().toLocaleString('en-US', {
      timeZone: this.timezone,
    });
    const d = new Date(now);
    const currentHour = d.getHours();
    const currentMinute = d.getMinutes();

    for (let i = 0; i < this._scheduledSlots.length; i++) {
      const slot = this._scheduledSlots[i];
      if (
        slot &&
        slot.hour === currentHour &&
        slot.minute === currentMinute
      ) {
        utilities.logToFile(
          `Scheduler: slot hit – posting type "${slot.postType}"`
        );
        this._scheduledSlots[i] = null; // mark as consumed
        this.onPostDue(slot.postType);
      }
    }
  }

  getSchedule() {
    let serverTime;
    try {
      serverTime = new Date().toLocaleString('en-US', {
        timeZone: this.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      serverTime = new Date().toLocaleTimeString();
    }
    return {
      postsPerDay: this.postsPerDay,
      activeWindow: `${this.activeHoursStart}:00\u2013${this.activeHoursEnd}:00`,
      timezone: this.timezone,
      serverTime,
      todaysSlots: this._scheduledSlots.filter(Boolean),
      postTypes: this.postTypes,
      postTypeWeights: this.postTypeWeights,
      running: this._running,
    };
  }

  /** Update schedule settings and regenerate slots */
  updateSettings(settings) {
    const tzChanged = settings.timezone && settings.timezone !== this.timezone;

    if (settings.postsPerDay !== undefined)
      this.postsPerDay = settings.postsPerDay;
    if (settings.activeHoursStart !== undefined)
      this.activeHoursStart = settings.activeHoursStart;
    if (settings.activeHoursEnd !== undefined)
      this.activeHoursEnd = settings.activeHoursEnd;
    if (settings.timezone) this.timezone = settings.timezone;
    if (settings.postTypes) this.postTypes = settings.postTypes;
    if (settings.postTypeWeights)
      this.postTypeWeights = settings.postTypeWeights;

    this.generateDailySlots();

    if (tzChanged && this._running) {
      utilities.logToFile(`Scheduler: timezone changed to ${this.timezone}, restarting cron jobs`);
      this._startCronJobs();
    }
  }
}

module.exports = PostScheduler;
