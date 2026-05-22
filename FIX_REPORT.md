# Fix Report: 412 Precondition Failed Upload Error

## Root Cause

The bot was uploading raw PNG images directly to Instagram's `/rupload_igphoto` endpoint. Instagram requires **JPEG** format for feed uploads. When a non-JPEG file (PNG, WebP) is sent, Instagram rejects it with `412 Precondition Failed`. Re-login does not help because authentication is fine — the media format is the problem.

## Changed Files

| File | Changes |
|------|---------|
| `src/media-normalizer.js` | **NEW** — Image normalization pipeline using `sharp`. Converts any input (PNG/WebP/GIF) to Instagram-safe JPEG with proper dimensions, aspect ratio, sRGB colorspace, and metadata stripping. |
| `src/instagram.js` | Uses normalized JPEG buffer for uploads. Structured error logging with upload metadata. Smart 412 handling (only re-logins for auth errors). Dry-run mode support. |
| `src/bot.js` | Candidate retry system (up to 3 attempts). URL validation before download. Passes source URL to Instagram for logging. |
| `src/scraper.js` | Accepts WebP URLs (will be normalized). Unchanged for existing jpg/png. |
| `test/media-normalizer.test.js` | **NEW** — 16 unit tests covering PNG/JPEG/WebP conversion, wide/tall/oversized/undersized images, URL validation. |

## How to Run

```bash
git pull origin main
rm -rf node_modules data/ig-session.json data/account-guard.json
npm install
npm start
```

## How to Test Dry-Run

Dry-run mode scrapes a meme, normalizes it to JPEG, generates a caption, but **skips** the actual Instagram upload:

```bash
DRY_RUN_UPLOAD=true npm start
```

Then click "Post Now" in the dashboard. Logs will show:
```
[INFO] MediaNorm: input png 800x600 (123 KB) from https://i.redd.it/example.png
[INFO] MediaNorm: output jpeg 800x600 (95 KB, q=90)
[INFO] Instagram: DRY RUN – skipping upload. Media: {...}
```

## How to Debug Future 412 Errors

1. Set `DEBUG_MEDIA=true` in `.env` to save the last normalized image to `data/debug-last-upload.jpg`
2. Check logs for structured upload metadata:
   - Original format, dimensions, size
   - Normalized format, dimensions, size, quality
   - Upload ID, endpoint, response status
3. If 412 persists with valid JPEG, the session may genuinely be expired — the bot will auto re-login
4. If re-login also fails, check Instagram app for checkpoint/challenge

## Media Normalization Rules

- **Format**: All images → JPEG (sRGB, no alpha, mozjpeg)
- **Width**: 320px–1440px (scales up/down as needed)
- **Aspect ratio**: 4:5 to 1.91:1 (pads with white if outside range)
- **File size**: Max 8 MB (reduces JPEG quality if needed, min q=50)
- **Rejected**: Videos (.mp4/.webm/.mov), animated GIFs, galleries, v.redd.it links

## Remaining Vulnerabilities (npm audit)

9 vulnerabilities remain, all in `instagram-private-api`'s transitive dependencies:

| Package | Severity | Runtime Relevant? |
|---------|----------|-------------------|
| `form-data` (via request) | Critical | No — boundary randomness, not exploitable in this bot |
| `qs` (via request) | Moderate | No — DoS via crafted query string, bot doesn't parse user input |
| `tough-cookie` | Moderate | No — prototype pollution, bot doesn't process untrusted cookies |
| `uuid` (via node-cron) | Moderate | No — buffer bounds, bot doesn't use buf option |

These have no available fix because `instagram-private-api` depends on the deprecated `request` package. They are not runtime-relevant for this bot's use case (server-side, no user input parsing).
