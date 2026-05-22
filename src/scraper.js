const axios = require('axios');
const utilities = require('./utils');

/**
 * Keyword pools organised by post type.
 * Each type maps to an array of search terms.
 */
const KEYWORD_POOLS = {
  funny: [
    'funny memes',
    'hilarious memes',
    'best memes 2024',
    'funny relatable memes',
    'clean funny memes',
  ],
  hinglish: [
    'desi memes',
    'indian memes',
    'hinglish memes',
    'hindi memes',
    'bollywood memes',
  ],
  trending: [
    'trending memes today',
    'viral memes',
    'latest memes',
    'trending funny memes',
  ],
  desi: [
    'desi jokes',
    'indian funny memes',
    'desi relatable',
    'indian college memes',
  ],
  relatable: [
    'relatable memes',
    'daily life memes',
    'work memes',
    'student memes',
  ],
  programming: [
    'programming memes',
    'developer memes',
    'coding humor',
    'tech memes',
  ],
};

/** Flat list for backward compat */
const HINGLISH_KEYWORDS = KEYWORD_POOLS.hinglish;

/**
 * Meme subreddit pools mapped by post type for the Reddit/Meme API source.
 */
const SUBREDDIT_POOLS = {
  funny: ['memes', 'dankmemes', 'me_irl', 'funny'],
  hinglish: ['IndianDankMemes', 'desimemes', 'indiameme', 'bollywoodmemes'],
  trending: ['memes', 'dankmemes', 'MemeEconomy', 'AdviceAnimals'],
  desi: ['IndianDankMemes', 'desimemes', 'indiameme'],
  relatable: ['me_irl', 'meirl', '2meirl4meirl', 'relatable_memes'],
  programming: ['ProgrammerHumor', 'programmingmemes', 'codingmemes'],
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * Get a meme image URL.  Tries multiple sources in order:
 * 1. Meme API (meme-api.com) – lightweight, no browser needed
 * 2. Reddit JSON API – direct subreddit scrape
 * 3. Pinterest HTML scrape (axios) – fallback
 */
async function getSafeMeme(keyword = 'funny memes', postType) {
  const type = postType || _typeFromKeyword(keyword);

  const sources = [
    () => _fromMemeApi(type),
    () => _fromRedditJson(type),
    () => _fromPinterestHtml(keyword),
  ];

  for (const source of sources) {
    try {
      const url = await utilities.retry(source, 2, 5000);
      if (url) return url;
    } catch (err) {
      utilities.logToFile(`Scraper: source failed – ${err.message}`, 'warn');
    }
  }

  throw new Error('All meme sources exhausted');
}

/* ------------------------------------------------------------------ */
/*  Source 1: Meme API (meme-api.com)                                  */
/* ------------------------------------------------------------------ */

async function _fromMemeApi(type) {
  const subs = SUBREDDIT_POOLS[type] || SUBREDDIT_POOLS.funny;
  const sub = subs[Math.floor(Math.random() * subs.length)];

  utilities.logToFile(`Scraper: trying meme-api.com (r/${sub})`);

  const { data } = await axios.get(
    `https://meme-api.com/gimme/${sub}`,
    { timeout: 15000, headers: { 'User-Agent': USER_AGENT } }
  );

  if (!data || !data.url || data.nsfw) {
    throw new Error('Meme API returned no suitable image');
  }

  // only accept direct image URLs
  if (!/\.(jpg|jpeg|png|gif)$/i.test(data.url)) {
    throw new Error('Meme API returned non-image URL');
  }

  utilities.logToFile(`Scraper: selected ${data.url} (via meme-api)`);
  return data.url;
}

/* ------------------------------------------------------------------ */
/*  Source 2: Reddit JSON API                                          */
/* ------------------------------------------------------------------ */

async function _fromRedditJson(type) {
  const subs = SUBREDDIT_POOLS[type] || SUBREDDIT_POOLS.funny;
  const sub = subs[Math.floor(Math.random() * subs.length)];
  const sort = ['hot', 'top', 'new'][Math.floor(Math.random() * 3)];

  utilities.logToFile(`Scraper: trying Reddit JSON (r/${sub}/${sort})`);

  const { data } = await axios.get(
    `https://www.reddit.com/r/${sub}/${sort}.json?limit=50&t=week`,
    {
      timeout: 15000,
      headers: { 'User-Agent': USER_AGENT },
    }
  );

  const posts = (data.data.children || [])
    .map((c) => c.data)
    .filter(
      (p) =>
        !p.over_18 &&
        !p.stickied &&
        p.url &&
        /\.(jpg|jpeg|png)$/i.test(p.url) &&
        p.ups > 50
    );

  if (!posts.length) throw new Error('No suitable Reddit posts');

  const pick = posts[Math.floor(Math.random() * Math.min(posts.length, 20))];
  utilities.logToFile(`Scraper: selected ${pick.url} (via Reddit)`);
  return pick.url;
}

/* ------------------------------------------------------------------ */
/*  Source 3: Pinterest HTML scrape (no browser)                        */
/* ------------------------------------------------------------------ */

async function _fromPinterestHtml(keyword) {
  const encoded = encodeURIComponent(keyword);
  utilities.logToFile(`Scraper: trying Pinterest HTML for "${keyword}"`);

  const { data: html } = await axios.get(
    `https://www.pinterest.com/search/pins/?q=${encoded}&rs=typed`,
    {
      timeout: 30000,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }
  );

  // extract pinimg URLs from the raw HTML
  const regex = /https:\/\/i\.pinimg\.com\/(?:originals|736x|474x|236x)\/[a-f0-9/]+\.(?:jpg|jpeg|png)/gi;
  const matches = html.match(regex) || [];

  // upgrade to originals
  const urls = [
    ...new Set(
      matches.map((u) =>
        u
          .replace('/236x/', '/originals/')
          .replace('/474x/', '/originals/')
          .replace('/736x/', '/originals/')
      )
    ),
  ];

  if (!urls.length) throw new Error('No images found on Pinterest');

  const selected = urls[Math.floor(Math.random() * urls.length)];
  utilities.logToFile(`Scraper: selected ${selected} (via Pinterest HTML)`);
  return selected;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function _typeFromKeyword(keyword) {
  const kw = keyword.toLowerCase();
  for (const [type, keywords] of Object.entries(KEYWORD_POOLS)) {
    if (keywords.some((k) => kw.includes(k.split(' ')[0]))) return type;
  }
  return 'funny';
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
