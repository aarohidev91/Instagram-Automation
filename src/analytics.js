const fs = require('fs');
const path = require('path');

/**
 * Analytics engine – tracks every post and provides insights for the
 * dashboard.  All data is stored in a single JSON file.
 */
class Analytics {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(process.cwd(), 'data');
    this.filePath = path.join(this.dataDir, 'analytics.json');
    this.data = this._load();
  }

  _ensureDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch {
      /* corrupted */
    }
    return { posts: [], errors: [], startTime: Date.now() };
  }

  _save() {
    this._ensureDir();
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  recordPost(details) {
    this.data.posts.push({
      timestamp: Date.now(),
      date: new Date().toISOString(),
      ...details,
    });
    // keep the last 500 posts
    if (this.data.posts.length > 500) {
      this.data.posts = this.data.posts.slice(-500);
    }
    this._save();
  }

  recordError(error) {
    this.data.errors.push({
      timestamp: Date.now(),
      date: new Date().toISOString(),
      message: error.message || String(error),
      stack: error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : '',
    });
    if (this.data.errors.length > 200) {
      this.data.errors = this.data.errors.slice(-200);
    }
    this._save();
  }

  getOverview() {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const week = 7 * day;

    const postsToday = this.data.posts.filter(
      (p) => now - p.timestamp < day
    ).length;
    const postsThisWeek = this.data.posts.filter(
      (p) => now - p.timestamp < week
    ).length;
    const errorsToday = this.data.errors.filter(
      (e) => now - e.timestamp < day
    ).length;

    // success rate (last 7 days)
    const recentPosts = this.data.posts.filter(
      (p) => now - p.timestamp < week
    ).length;
    const recentErrors = this.data.errors.filter(
      (e) => now - e.timestamp < week
    ).length;
    const total = recentPosts + recentErrors;
    const successRate = total > 0
      ? Math.round((recentPosts / total) * 100)
      : 100;

    // posts per day (last 7 days)
    const dailyCounts = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(now - i * day).toISOString().slice(0, 10);
      dailyCounts[d] = 0;
    }
    this.data.posts
      .filter((p) => now - p.timestamp < week)
      .forEach((p) => {
        const d = new Date(p.timestamp).toISOString().slice(0, 10);
        if (dailyCounts[d] !== undefined) dailyCounts[d] += 1;
      });

    // post type distribution
    const typeDist = {};
    this.data.posts.forEach((p) => {
      const t = p.postType || 'unknown';
      typeDist[t] = (typeDist[t] || 0) + 1;
    });

    return {
      totalPosts: this.data.posts.length,
      postsToday,
      postsThisWeek,
      errorsToday,
      successRate,
      dailyCounts,
      postTypeDistribution: typeDist,
      uptimeMs: now - (this.data.startTime || now),
      recentPosts: this.data.posts.slice(-10).reverse(),
      recentErrors: this.data.errors.slice(-10).reverse(),
    };
  }
}

module.exports = Analytics;
