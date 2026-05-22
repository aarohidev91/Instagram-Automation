# Instagram Meme Bot v2

[![npm version](https://badge.fury.io/js/instagram-meme-bot.svg)](https://badge.fury.io/js/instagram-meme-bot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Production-ready Instagram meme bot with a **web GUI dashboard**, **smart scheduling**, **rate limiting**, **account safety**, and a **keep-alive ping** for free hosts like Render.

---

## Features

### Core
- **Automated Posting** – scrapes copyright-safe memes from Pinterest and posts them to Instagram
- **Smart Scheduling** – configurable posts per day distributed across an active time window with randomised slots
- **Selective Post Types** – choose from funny, hinglish, trending, desi, relatable, programming (or define your own)
- **Human-like Behaviour** – random delays, jittered intervals, hashtag rotation, caption variation

### Account Safety (Instagram T&C Compliance)
- **Rate Limiter** – sliding-window limits on posts/day, posts/hour, and actions/minute
- **Account Guard** – active-hours enforcement, warm-up period for new accounts, automatic safe-mode on errors
- **Checkpoint Detection** – detects Instagram security challenges and pauses the bot
- **Weekend Throttling** – optionally reduce posting on weekends
- **Exponential Backoff** – on failures, the bot backs off progressively
- **Session Persistence** – reuses Instagram sessions to avoid repeated logins

### GUI Dashboard
- **Real-time Status** – bot status, today's schedule, safety metrics
- **Analytics** – posts today/week, success rate, weekly chart, post-type distribution
- **Live Logs** – view the last 100 log entries
- **Settings Panel** – change posts/day, active hours, post types, limits – all from the browser
- **Controls** – start, stop, and trigger manual posts from the dashboard
- **REST API** – all dashboard features are backed by API endpoints

### Infrastructure
- **Keep-Alive Ping** – self-pings every 10 minutes to prevent Render/free-tier spin-down
- **Health Endpoint** – `GET /health` for uptime monitoring
- **Structured Logging** – timestamped, levelled logs with automatic rotation (5 MB)
- **Graceful Shutdown** – handles SIGINT/SIGTERM cleanly
- **Retry with Backoff** – all network operations retry with exponential backoff

---

## Quick Start

### Install

```bash
npm install -g instagram-meme-bot
```

### Configure

```bash
instagram-meme-bot config
```

Interactive prompts for: credentials, posts/day, active hours, post types, GUI port, Render URL.

### Start (Production Mode)

```bash
instagram-meme-bot start
```

This starts everything:
1. Instagram session
2. GUI dashboard (default port 3000)
3. Smart scheduler
4. Keep-alive pinger

Open `http://localhost:3000` to access the dashboard.

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `start` | Production mode – GUI + scheduler + keep-alive |
| `run` | Legacy continuous mode (no GUI) |
| `run --once` | Single post cycle |
| `dashboard` | Start only the GUI dashboard |
| `config` | Interactive configuration setup |
| `version` | Show version info |

---

## Configuration

All settings are read from environment variables (`.env` file). Copy `.env.example` to `.env` and edit:

| Variable | Description | Default |
|----------|-------------|---------|
| `INSTA_USERNAME` | Instagram username | *required* |
| `INSTA_PASSWORD` | Instagram password | *required* |
| `POSTS_PER_DAY` | Target posts per day | `3` |
| `ACTIVE_HOURS_START` | Start of posting window (0-23) | `9` |
| `ACTIVE_HOURS_END` | End of posting window (0-23) | `23` |
| `TIMEZONE` | Timezone for scheduling | `Asia/Kolkata` |
| `POST_TYPES` | Comma-separated post categories | `funny,hinglish,trending` |
| `MAX_POSTS_PER_DAY` | Hard safety limit | `5` |
| `MIN_POST_INTERVAL_MIN` | Minimum minutes between posts | `30` |
| `MAX_POST_INTERVAL_MIN` | Maximum minutes between posts | `120` |
| `WARM_UP_DAYS` | Days to gradually ramp up activity | `7` |
| `SAFE_MODE_HOURS` | Hours to pause after consecutive errors | `6` |
| `ENABLE_WEEKEND_PAUSE` | Reduce posting on weekends | `false` |
| `WEEKEND_MAX_POSTS` | Max posts on weekend days | `2` |
| `GUI_ENABLED` | Enable the web dashboard | `true` |
| `GUI_PORT` | Dashboard port | `3000` |
| `RENDER_EXTERNAL_URL` | App URL for keep-alive ping | *(empty)* |
| `KEEP_ALIVE_INTERVAL` | Ping interval in minutes | `10` |

### Post Types

Available types: `funny`, `hinglish`, `trending`, `desi`, `relatable`, `programming`

Set `POST_TYPES=funny,hinglish,trending` to only post from those categories.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/status` | Full bot status |
| GET | `/api/analytics` | Post analytics |
| GET | `/api/schedule` | Today's schedule |
| POST | `/api/schedule` | Update schedule settings |
| POST | `/api/post-now` | Trigger a post immediately |
| POST | `/api/bot/start` | Start the scheduler |
| POST | `/api/bot/stop` | Stop the bot |
| GET | `/api/rate-limiter` | Rate limiter stats |
| GET | `/api/account-guard` | Account safety stats |
| GET | `/api/logs` | Last 100 log lines |
| GET | `/api/settings` | Current settings |
| POST | `/api/settings` | Update settings |

---

## Deployment on Render

1. Create a new **Web Service** on Render
2. Set the build command: `npm install`
3. Set the start command: `npm start`
4. Add all environment variables from `.env.example`
5. Set `RENDER_EXTERNAL_URL` to your app's Render URL
6. The built-in keep-alive ping will prevent spin-down

---

## Programmatic Usage

```javascript
const InstagramMemeBot = require('instagram-meme-bot');
const bot = new InstagramMemeBot();

// Production mode (GUI + scheduler + keep-alive)
await bot.start();

// Single post
await bot.runOnce();

// Legacy continuous
await bot.run();
```

---

## Architecture

```
src/
  index.js          – main entry point, wires everything together
  bot.js            – orchestrates scraping + posting + safety
  instagram.js      – Instagram API client with session management
  scraper.js        – multi-source meme scraper (Meme API, Reddit, Pinterest)
  config.js         – centralised configuration with typed getters
  utils.js          – logging, retry, file helpers
  rate-limiter.js   – sliding-window rate limiter (persisted)
  account-guard.js  – account safety engine (active hours, warm-up, safe mode)
  scheduler.js      – cron-based post scheduler with random slots
  analytics.js      – post & error tracking with insights
  keep-alive.js     – self-ping for Render/free hosts
  server.js         – Express GUI dashboard server
  public/
    index.html      – dashboard UI
    style.css       – dashboard styles
    app.js          – dashboard frontend logic
```

---

## Safety & Instagram T&C Compliance

The bot follows these practices to keep your account safe:

1. **Posts only during human hours** (default 9 AM – 11 PM IST)
2. **Limits posts per day** (default 3, hard limit 5)
3. **Enforces minimum intervals** between posts (30+ minutes)
4. **Randomises all delays** – no two intervals are identical
5. **Warm-up period** – new accounts start with fewer posts and ramp up over 7 days
6. **Automatic safe mode** – pauses for 6 hours after 3 consecutive errors
7. **Checkpoint handling** – clears session and pauses for 12 hours on Instagram security challenges
8. **Hashtag rotation** – cycles through different hashtag groups to avoid repetition
9. **Credits original creators** – every caption includes creator credit
10. **Weekend throttling** – optionally post less on weekends

---

## Troubleshooting

### Instagram Login Issues
```bash
rm -rf data/ig-session.json
instagram-meme-bot config
```

### Memory Issues
```bash
node --max-old-space-size=4096 bin/cli.js start
```

---

## License

MIT
