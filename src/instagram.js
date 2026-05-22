const { IgApiClient } = require('instagram-private-api');
const fs = require('fs');
const path = require('path');
const utilities = require('./utils');
const { normalizeImage } = require('./media-normalizer');

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
        await this._postLoginSetup();
      } else {
        await this._fullLogin();
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

  async _fullLogin() {
    utilities.logToFile('Instagram: logging in with full simulation...');
    await this.ig.simulate.preLoginFlow();
    await utilities.randomDelay(2000, 4000);
    await this.ig.account.login(
      process.env.INSTA_USERNAME,
      process.env.INSTA_PASSWORD
    );
    // post-login: sync experiments and accept consent/TOS
    await this._postLoginSetup();
    // post-login simulation — run in background, don't block
    this.ig.simulate.postLoginFlow().catch(() => {});
    await utilities.randomDelay(2000, 4000);
    await this._saveSession();
    utilities.logToFile('Instagram: logged in and saved session');
  }

  async _postLoginSetup() {
    try {
      await this.ig.qe.syncLoginExperiments();
      utilities.logToFile('Instagram: synced login experiments');
    } catch (e) {
      if (e.message.includes('checkpoint') || e.message.includes('challenge')) throw e;
      utilities.logToFile(`Instagram: qe sync skipped – ${e.message}`, 'debug');
    }
    try {
      await this.ig.consent.existingUserFlowTosAndTwoAgeButton();
      utilities.logToFile('Instagram: accepted consent/TOS');
    } catch (e) {
      if (e.message.includes('checkpoint') || e.message.includes('challenge')) throw e;
      utilities.logToFile(`Instagram: consent flow skipped – ${e.message}`, 'debug');
    }
    await utilities.randomDelay(1000, 2000);
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

  /**
   * Post an image to Instagram.
   * @param {string} imagePath  path to the raw downloaded image
   * @param {string} [sourceUrl]  original URL for logging
   */
  async postImage(imagePath, sourceUrl) {
    const check = utilities.validateImage(imagePath);
    if (!check.valid) {
      throw new Error(`Image validation failed: ${check.reason}`);
    }

    // normalize to Instagram-safe JPEG
    const rawBuffer = await fs.promises.readFile(imagePath);
    const { buffer: jpegBuffer, metadata: mediaMeta } = await normalizeImage(rawBuffer, sourceUrl || imagePath);

    // dry-run mode: skip actual upload
    if (process.env.DRY_RUN_UPLOAD === 'true') {
      const caption = this.generateCaption();
      utilities.logToFile(
        `Instagram: DRY RUN – skipping upload. Media: ${JSON.stringify(mediaMeta.normalized)}, Caption length: ${caption.length}`
      );
      return { success: true, caption, dryRun: true };
    }

    const caption = this.generateCaption();
    const uploadId = Date.now().toString();

    try {
      return await this._attemptPost(jpegBuffer, caption, uploadId, mediaMeta);
    } catch (error) {
      // only re-login for auth/session errors, not media issues
      if (this._isSessionError(error)) {
        utilities.logToFile('Instagram: session error detected – re-logging in...');
        await this._reLogin();
        return await this._attemptPost(jpegBuffer, caption, uploadId, mediaMeta);
      }
      throw error;
    }
  }

  _isSessionError(error) {
    const msg = error.message || '';
    return (
      msg.includes('login_required') ||
      msg.includes('401') ||
      msg.includes('Not authorized') ||
      (msg.includes('412') && msg.includes('Precondition'))
    );
  }

  async _attemptPost(fileData, caption, uploadId, mediaMeta) {
    try {
      utilities.logToFile(
        `Instagram: uploading post (upload_id=${uploadId}, ` +
        `${mediaMeta.normalized.width}x${mediaMeta.normalized.height}, ` +
        `${(mediaMeta.normalized.size / 1024).toFixed(0)} KB)...`
      );
      await utilities.randomDelay(3000, 7000);

      await this.ig.publish.photo({ file: fileData, caption });

      await this._saveSession();
      utilities.logToFile('Instagram: post successful!');
      await utilities.randomDelay(5000, 15000);
      return { success: true, caption };
    } catch (error) {
      this._logUploadError(error, uploadId, mediaMeta);
      throw error;
    }
  }

  _logUploadError(error, uploadId, mediaMeta) {
    utilities.logToFile(
      `Instagram: upload failed – ${error.message}`,
      'error'
    );

    // capture full API response body for diagnostics
    if (error.response && error.response.body) {
      utilities.logToFile(
        `Instagram: response body – ${JSON.stringify(error.response.body)}`,
        'error'
      );
    }
    if (error.response && error.response.statusCode) {
      utilities.logToFile(
        `Instagram: status=${error.response.statusCode}`,
        'error'
      );
    }

    utilities.logToFile(
      `Instagram: upload details – upload_id=${uploadId} ` +
      `original=${JSON.stringify(mediaMeta.original)} ` +
      `normalized=${JSON.stringify(mediaMeta.normalized)}`,
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
  }

  async _reLogin() {
    utilities.cleanupFile(this.sessionPath);
    this.ig = new IgApiClient();
    this.ig.state.generateDevice(process.env.INSTA_USERNAME);
    await this._fullLogin();
    utilities.logToFile('Instagram: re-login successful');
  }
}

module.exports = InstagramPoster;
