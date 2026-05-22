const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const utilities = require('./utils');

puppeteer.use(StealthPlugin());

/**
 * Keyword pools organised by post type.
 * Each type maps to an array of URL-encoded search terms.
 */
const KEYWORD_POOLS = {
  funny: [
    'funny%20memes',
    'hilarious%20memes',
    'best%20memes%202024',
    'funny%20relatable%20memes',
    'clean%20funny%20memes',
  ],
  hinglish: [
    'desi%20memes',
    'indian%20memes',
    'hinglish%20memes',
    'hindi%20memes',
    'aaj%20ka%20trending%20meme',
    'bollywood%20memes',
  ],
  trending: [
    'trending%20memes%20today',
    'viral%20memes',
    'latest%20memes',
    'trending%20funny%20memes',
  ],
  desi: [
    'desi%20jokes',
    'indian%20funny%20memes',
    'desi%20relatable',
    'indian%20college%20memes',
  ],
  relatable: [
    'relatable%20memes',
    'daily%20life%20memes',
    'work%20memes',
    'student%20memes',
  ],
  programming: [
    'programming%20memes',
    'developer%20memes',
    'coding%20humor',
    'tech%20memes',
  ],
};

/** Flat list for backward compat */
const HINGLISH_KEYWORDS = KEYWORD_POOLS.hinglish;

/**
 * Scrape copyright-safe memes from Pinterest with retries and
 * resource-safe browser management.
 */
async function getSafeMeme(keyword = 'funny%20memes') {
  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
      ],
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });

    return await utilities.retry(
      () => _scrapePage(browser, keyword),
      3,
      10000
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* already closed */
      }
    }
  }
}

async function _scrapePage(browser, keyword) {
  let page = null;
  try {
    page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });

    utilities.logToFile(`Scraper: loading Pinterest for "${decodeURIComponent(keyword)}"`);
    await page.goto(
      `https://www.pinterest.com/search/pins/?q=${keyword}&rs=typed`,
      { waitUntil: 'networkidle2', timeout: 120000 }
    );

    await utilities.randomDelay(2000, 5000);

    // scroll to load images
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 1500));
      await utilities.delay(1500 + Math.random() * 1500);
    }

    const memeUrls = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img'))
        .map((img) => {
          let src = img.src;
          if (src.includes('/236x/'))
            src = src.replace('/236x/', '/originals/');
          else if (src.includes('/474x/'))
            src = src.replace('/474x/', '/originals/');
          else if (src.includes('/736x/'))
            src = src.replace('/736x/', '/originals/');
          return src;
        })
        .filter(
          (src) =>
            src.startsWith('https://i.pinimg.com/originals/') &&
            /\.(jpg|jpeg|png)$/i.test(src)
        );
    });

    if (!memeUrls.length) throw new Error('No copyright-safe memes found');

    const selected =
      memeUrls[Math.floor(Math.random() * memeUrls.length)];
    utilities.logToFile(`Scraper: selected ${selected}`);
    return selected;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        /* already closed */
      }
    }
  }
}

/**
 * Pick a random keyword for the given post type.
 */
function getRandomKeyword(postType) {
  if (postType && KEYWORD_POOLS[postType]) {
    const pool = KEYWORD_POOLS[postType];
    const keyword = pool[Math.floor(Math.random() * pool.length)];
    return { keyword, type: postType };
  }

  // fallback: random type
  const types = Object.keys(KEYWORD_POOLS);
  const type = types[Math.floor(Math.random() * types.length)];
  const pool = KEYWORD_POOLS[type];
  const keyword = pool[Math.floor(Math.random() * pool.length)];
  return { keyword, type };
}

module.exports = {
  getSafeMeme,
  getRandomKeyword,
  KEYWORD_POOLS,
  HINGLISH_KEYWORDS,
};
