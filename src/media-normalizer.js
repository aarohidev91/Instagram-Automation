const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const utilities = require('./utils');

// Instagram feed constraints
const MIN_WIDTH = 320;
const MAX_WIDTH = 1440;
const MIN_RATIO = 4 / 5;   // tallest (portrait)
const MAX_RATIO = 1.91;     // widest (landscape)
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB
const DEBUG_DIR = path.join(process.cwd(), 'data');

/**
 * Normalize an image buffer for Instagram feed upload.
 * - Converts PNG/WebP/GIF (first frame) → JPEG
 * - Ensures sRGB colorspace
 * - Strips unsupported metadata
 * - Enforces Instagram dimension/aspect ratio constraints
 * - Pads with white if aspect ratio is outside range
 *
 * @param {Buffer} inputBuffer  raw image bytes
 * @param {string} sourceUrl    for logging
 * @returns {Promise<{buffer: Buffer, metadata: Object}>}
 */
async function normalizeImage(inputBuffer, sourceUrl) {
  const img = sharp(inputBuffer, { animated: false });
  const meta = await img.metadata();

  const origInfo = {
    format: meta.format,
    width: meta.width,
    height: meta.height,
    size: inputBuffer.length,
    sourceUrl,
  };

  utilities.logToFile(
    `MediaNorm: input ${meta.format} ${meta.width}x${meta.height} ` +
    `(${(inputBuffer.length / 1024).toFixed(0)} KB) from ${sourceUrl}`
  );

  let pipeline = sharp(inputBuffer, { animated: false })
    .toColorspace('srgb')
    .removeAlpha();

  let { width, height } = meta;

  // compute final dimensions in pure math first, then issue one resize
  if (width > MAX_WIDTH) {
    const scale = MAX_WIDTH / width;
    height = Math.round(height * scale);
    width = MAX_WIDTH;
  } else if (width < MIN_WIDTH) {
    const scale = MIN_WIDTH / width;
    height = Math.round(height * scale);
    width = MIN_WIDTH;
  }

  // single resize to target dimensions
  pipeline = pipeline.resize(width, height, { fit: 'fill', withoutEnlargement: false });

  // fix aspect ratio by padding (after resize is settled)
  const ratio = width / height;
  let extendOpts = null;

  if (ratio > MAX_RATIO) {
    const newHeight = Math.round(width / MAX_RATIO);
    extendOpts = {
      top: Math.floor((newHeight - height) / 2),
      bottom: Math.ceil((newHeight - height) / 2),
      background: { r: 255, g: 255, b: 255 },
    };
    height = newHeight;
  } else if (ratio < MIN_RATIO) {
    const newWidth = Math.round(height * MIN_RATIO);
    extendOpts = {
      left: Math.floor((newWidth - width) / 2),
      right: Math.ceil((newWidth - width) / 2),
      background: { r: 255, g: 255, b: 255 },
    };
    width = newWidth;
  }

  if (extendOpts) {
    pipeline = pipeline.extend(extendOpts);
  }

  // output as JPEG, strip metadata
  let quality = 90;
  let outputBuffer = await pipeline
    .jpeg({ quality, chromaSubsampling: '4:2:0', mozjpeg: true })
    .toBuffer();

  // reduce quality if output is too large
  while (outputBuffer.length > MAX_FILE_SIZE && quality > 50) {
    quality -= 10;
    outputBuffer = await sharp(outputBuffer)
      .jpeg({ quality, chromaSubsampling: '4:2:0', mozjpeg: true })
      .toBuffer();
  }

  const outMeta = await sharp(outputBuffer).metadata();

  const normInfo = {
    format: 'jpeg',
    width: outMeta.width,
    height: outMeta.height,
    size: outputBuffer.length,
    quality,
  };

  utilities.logToFile(
    `MediaNorm: output jpeg ${outMeta.width}x${outMeta.height} ` +
    `(${(outputBuffer.length / 1024).toFixed(0)} KB, q=${quality})`
  );

  // save debug copy when DEBUG_MEDIA=true
  if (process.env.DEBUG_MEDIA === 'true') {
    try {
      if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
      const debugPath = path.join(DEBUG_DIR, 'debug-last-upload.jpg');
      fs.writeFileSync(debugPath, outputBuffer);
      utilities.logToFile(`MediaNorm: debug copy saved to ${debugPath}`);
    } catch (e) {
      utilities.logToFile(`MediaNorm: debug save failed – ${e.message}`, 'warn');
    }
  }

  return {
    buffer: outputBuffer,
    metadata: { original: origInfo, normalized: normInfo },
  };
}

/**
 * Validate a URL points to a supported still image.
 * Rejects videos, galleries, HTML pages, animated GIFs, huge files.
 */
function isAcceptableImageUrl(url) {
  if (!url || typeof url !== 'string') return false;

  // reject known video/gallery patterns
  if (/\.(mp4|webm|mov|avi|gifv)$/i.test(url)) return false;
  if (/\.(gif)$/i.test(url)) return false; // animated gifs not supported
  if (/\/gallery\//i.test(url)) return false;
  if (/v\.redd\.it/i.test(url)) return false;

  // must look like a direct image URL
  if (/\.(jpg|jpeg|png|webp)$/i.test(url)) return true;
  if (/i\.redd\.it|i\.imgur\.com|i\.pinimg\.com/i.test(url)) return true;

  return false;
}

module.exports = { normalizeImage, isAcceptableImageUrl };
