const { IgApiClient } = require('instagram-private-api');
const fs = require('fs');
const path = require('path');
const utilities = require('./utils');

/**
 * Caption templates organised by mood.
 * The bot randomly picks one and fills in dynamic parts so every
 * post looks different and human-authored.
 */
const CAPTION_TEMPLATES = [
  {
    body: 'Daily dose of laughter! {vibe}\n\nCredits to original creator\n{tags}',
    vibes: ['Hope this makes your day!', 'Enjoy!', 'Share with your squad!'],
  },
  {
    body: 'Just found this gem! {vibe}\n\nCredit to the creator\n{tags}',
    vibes: ['Couldn\'t stop laughing!', 'Too relatable!', 'Tag someone who needs this!'],
  },
  {
    body: 'Sharing some good vibes! {vibe}\n\nAll credits to the original creator\n{tags}',
    vibes: ['Hope this brightens your day!', 'Enjoy the laugh!', 'Double tap if you agree!'],
  },
  {
    body: '{vibe}\n\nOriginal creator gets all the credit!\n{tags}',
    vibes: ['Monday mood be like...', 'When life gives you memes...', 'POV: You found the perfect meme'],
  },
  {
    body: 'This one hit different! {vibe}\n\nCredits where due!\n{tags}',
    vibes: ['Save for later!', 'Send this to your bestie!', 'Relatable or nah?'],
  },
];

/**
 * Hashtag groups – the bot rotates through these to avoid repetition.
 */
const HASHTAG_GROUPS = [
  '#memes #funny #viral #trending #comedy #lol #memesdaily #indianmemes #desimemes #fun',
  '#funny #memes #viral #trending #laugh #comedy #indianmemes #desimemes #dankmemes',
  '#memes #humor #viral #trending #funny #comedy #dailymemes #laugh #entertainment',
  '#memesdaily #funnymemes #viralpost #comedymemes #relatablememes #trendingmemes',
  '#bestmemes #memepage #funnyvideos #comedyclub #laughoutloud #instamemes',
];

class InstagramPoster {
  constructor() {
    this.ig = new IgApiClient();
    this.sessionPath = path.join(process.cwd(), 'data', 'ig-session.json');
    this._lastHashtagIdx = -1;
  }

  async initialize() {
    const dataDir = path.dirname(this.sessionPath);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    this.ig.state.generateDevice(process.env.INSTA_USERNAME);

    try {
      if (fs.existsSync(this.sessionPath)) {
        const saved = JSON.parse(
          fs.readFileSync(this.sessionPath, 'utf8')
        );
        await this.ig.state.deserialize(saved);
        utilities.logToFile('Instagram: restored session');
      } else {
        utilities.logToFile('Instagram: logging in...');
        await utilities.randomDelay(2000, 4000);
        await this.ig.account.login(
          process.env.INSTA_USERNAME,
          process.env.INSTA_PASSWORD
        );
        await this._saveSession();
        utilities.logToFile('Instagram: logged in and saved session');
      }
    } catch (error) {
      utilities.logToFile(
        `Instagram: auth error – ${error.message}`,
        'error'
      );

      if (
        error.message.includes('checkpoint') ||
        error.message.includes('challenge')
      ) {
        utilities.logToFile(
          'Instagram: CHECKPOINT – verify in the Instagram app!',
          'error'
        );
        utilities.cleanupFile(this.sessionPath);
      }
      throw error;
    }
  }

  async _saveSession() {
    const session = await this.ig.state.serialize();
    delete session.constants;
    utilities.writeJSON(this.sessionPath, session);
  }

  generateCaption() {
    const tpl =
      CAPTION_TEMPLATES[
        Math.floor(Math.random() * CAPTION_TEMPLATES.length)
      ];
    const vibe = tpl.vibes[Math.floor(Math.random() * tpl.vibes.length)];

    // rotate hashtag group (never same as last time)
    let idx;
    do {
      idx = Math.floor(Math.random() * HASHTAG_GROUPS.length);
    } while (idx === this._lastHashtagIdx && HASHTAG_GROUPS.length > 1);
    this._lastHashtagIdx = idx;

    return tpl.body
      .replace('{vibe}', vibe)
      .replace('{tags}', HASHTAG_GROUPS[idx]);
  }

  async postImage(imagePath) {
    // validate image before uploading
    const check = utilities.validateImage(imagePath);
    if (!check.valid) {
      throw new Error(`Image validation failed: ${check.reason}`);
    }

    const caption = this.generateCaption();
    const fileData = await fs.promises.readFile(imagePath);

    try {
      return await this._attemptPost(fileData, caption);
    } catch (error) {
      // 412 = stale session → re-login and retry once
      if (error.message.includes('412') || error.message.includes('Precondition Failed')) {
        utilities.logToFile('Instagram: session expired (412) – re-logging in...');
        await this._reLogin();
        return await this._attemptPost(fileData, caption);
      }
      throw error;
    }
  }

  async _attemptPost(fileData, caption) {
    try {
      utilities.logToFile('Instagram: uploading post...');
      await utilities.randomDelay(3000, 7000);

      await this.ig.publish.photo({ file: fileData, caption });

      await this._saveSession();
      utilities.logToFile('Instagram: post successful!');
      await utilities.randomDelay(5000, 15000);
      return { success: true, caption };
    } catch (error) {
      throw this._handlePostError(error);
    }
  }

  _handlePostError(error) {
    utilities.logToFile(
      `Instagram: posting error – ${error.message}`,
      'error'
    );
    if (
      error.message.includes('checkpoint') ||
      error.message.includes('challenge')
    ) {
      utilities.logToFile(
        'Instagram: CHECKPOINT – verify in the Instagram app!',
        'error'
      );
      utilities.cleanupFile(this.sessionPath);
    }
    return error;
  }

  async _reLogin() {
    utilities.cleanupFile(this.sessionPath);
    this.ig = new IgApiClient();
    this.ig.state.generateDevice(process.env.INSTA_USERNAME);
    await utilities.randomDelay(2000, 4000);
    await this.ig.account.login(
      process.env.INSTA_USERNAME,
      process.env.INSTA_PASSWORD
    );
    await this._saveSession();
    utilities.logToFile('Instagram: re-login successful');
  }
}

module.exports = InstagramPoster;
