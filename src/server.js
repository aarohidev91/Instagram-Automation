const express = require('express');
const path = require('path');

/**
 * Express-based GUI dashboard server.
 * Serves a single-page dashboard and exposes REST endpoints
 * for live status, analytics, and settings management.
 */
function createServer(bot) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  /* ---- health (also used by keep-alive ping) ---------------------- */
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  /* ---- full status ------------------------------------------------ */
  app.get('/api/status', (_req, res) => {
    try {
      res.json(bot.getStatus());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ---- analytics -------------------------------------------------- */
  app.get('/api/analytics', (_req, res) => {
    try {
      res.json(bot.analytics.getOverview());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ---- scheduler -------------------------------------------------- */
  app.get('/api/schedule', (_req, res) => {
    res.json(bot.scheduler.getSchedule());
  });

  app.post('/api/schedule', (req, res) => {
    try {
      bot.scheduler.updateSettings(req.body);
      res.json({ ok: true, schedule: bot.scheduler.getSchedule() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /* ---- manual trigger --------------------------------------------- */
  app.post('/api/post-now', async (req, res) => {
    try {
      const { keyword, postType } = req.body || {};
      const result = await bot.runCycleImmediate(keyword, postType);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ---- bot controls ----------------------------------------------- */
  app.post('/api/bot/start', async (_req, res) => {
    try {
      bot.startScheduled();
      res.json({ ok: true, status: 'running' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/bot/stop', (_req, res) => {
    bot.requestShutdown();
    res.json({ ok: true, status: 'stopped' });
  });

  /* ---- clear safe mode --------------------------------------------- */
  app.post('/api/clear-safe-mode', (_req, res) => {
    try {
      bot.accountGuard.clearSafeMode();
      bot.rateLimiter.clearCooldown();
      res.json({ ok: true, message: 'Safe mode and cooldown cleared' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ---- rate-limiter stats ----------------------------------------- */
  app.get('/api/rate-limiter', (_req, res) => {
    res.json(bot.rateLimiter.getStats());
  });

  /* ---- account guard stats ---------------------------------------- */
  app.get('/api/account-guard', (_req, res) => {
    res.json(bot.accountGuard.getStats());
  });

  /* ---- logs (last 100 lines) -------------------------------------- */
  app.get('/api/logs', (_req, res) => {
    try {
      const fs = require('fs');
      const logFile = path.join(process.cwd(), 'logs', 'bot.log');
      if (!fs.existsSync(logFile)) return res.json({ logs: [] });
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.trim().split('\n').slice(-100);
      res.json({ logs: lines });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /* ---- settings --------------------------------------------------- */
  app.get('/api/settings', (_req, res) => {
    const ConfigManager = require('./config');
    const cfg = ConfigManager.getAll();
    delete cfg.password;
    res.json(cfg);
  });

  app.post('/api/settings', (req, res) => {
    try {
      const allowed = [
        'postsPerDay',
        'activeHoursStart',
        'activeHoursEnd',
        'timezone',
        'postTypes',
        'maxPostsPerDay',
        'minPostIntervalMin',
        'maxPostIntervalMin',
        'enableWeekendPause',
        'weekendMaxPosts',
      ];
      const update = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) update[key] = req.body[key];
      }
      // apply to scheduler (any scheduling-relevant key)
      const schedulerKeys = [
        'postsPerDay', 'activeHoursStart', 'activeHoursEnd',
        'postTypes', 'timezone',
      ];
      if (schedulerKeys.some((k) => update[k] !== undefined)) {
        bot.scheduler.updateSettings(update);
      }
      // apply to rate limiter
      if (update.maxPostsPerDay) {
        bot.rateLimiter.updateLimits({
          postsPerDay: update.maxPostsPerDay,
        });
      }
      // apply to account guard
      const guardKeys = [
        'activeHoursStart', 'activeHoursEnd',
        'enableWeekendPause', 'weekendMaxPosts', 'timezone',
      ];
      if (guardKeys.some((k) => update[k] !== undefined)) {
        bot.accountGuard.updateConfig(update);
      }
      res.json({ ok: true, applied: update });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /* ---- SPA fallback ----------------------------------------------- */
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

module.exports = createServer;
