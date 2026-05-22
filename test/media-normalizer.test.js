const sharp = require('sharp');
const { normalizeImage, isAcceptableImageUrl } = require('../src/media-normalizer');

// suppress log output during tests
jest.mock('../src/utils', () => ({
  logToFile: jest.fn(),
}));

async function createTestImage(format, width, height, options = {}) {
  const channels = format === 'png' ? 4 : 3;
  const raw = Buffer.alloc(width * height * channels, 128);
  let pipeline = sharp(raw, { raw: { width, height, channels } });

  if (format === 'png') return pipeline.png().toBuffer();
  if (format === 'webp') return pipeline.webp().toBuffer();
  if (format === 'jpeg' || format === 'jpg') return pipeline.jpeg().toBuffer();
  return pipeline.png().toBuffer();
}

describe('normalizeImage', () => {
  test('converts PNG input to JPEG', async () => {
    const png = await createTestImage('png', 800, 600);
    const { buffer, metadata } = await normalizeImage(png, 'http://test/img.png');

    expect(metadata.original.format).toBe('png');
    expect(metadata.normalized.format).toBe('jpeg');

    const outMeta = await sharp(buffer).metadata();
    expect(outMeta.format).toBe('jpeg');
    expect(buffer.length).toBeGreaterThan(0);
  });

  test('converts JPEG input (passthrough to JPEG)', async () => {
    const jpg = await createTestImage('jpeg', 800, 600);
    const { buffer, metadata } = await normalizeImage(jpg, 'http://test/img.jpg');

    expect(metadata.normalized.format).toBe('jpeg');
    const outMeta = await sharp(buffer).metadata();
    expect(outMeta.format).toBe('jpeg');
  });

  test('converts WebP input to JPEG', async () => {
    const webp = await createTestImage('webp', 800, 600);
    const { buffer, metadata } = await normalizeImage(webp, 'http://test/img.webp');

    expect(metadata.original.format).toBe('webp');
    expect(metadata.normalized.format).toBe('jpeg');
  });

  test('handles very wide image (pads to max aspect ratio)', async () => {
    // 1920x400 = ratio 4.8 (way wider than 1.91:1)
    const wide = await createTestImage('png', 1920, 400);
    const { buffer, metadata } = await normalizeImage(wide, 'http://test/wide.png');

    const outMeta = await sharp(buffer).metadata();
    const ratio = outMeta.width / outMeta.height;
    expect(ratio).toBeLessThanOrEqual(1.92); // allow tiny float rounding
    expect(outMeta.width).toBeLessThanOrEqual(1440);
    expect(outMeta.format).toBe('jpeg');
  });

  test('handles very tall image (pads to min aspect ratio)', async () => {
    // 400x1200 = ratio 0.33 (taller than 4:5 = 0.8)
    const tall = await createTestImage('png', 400, 1200);
    const { buffer, metadata } = await normalizeImage(tall, 'http://test/tall.png');

    const outMeta = await sharp(buffer).metadata();
    const ratio = outMeta.width / outMeta.height;
    expect(ratio).toBeGreaterThanOrEqual(0.79); // allow tiny float rounding
    expect(outMeta.format).toBe('jpeg');
  });

  test('scales down oversized image', async () => {
    const big = await createTestImage('png', 3000, 2000);
    const { buffer } = await normalizeImage(big, 'http://test/big.png');

    const outMeta = await sharp(buffer).metadata();
    expect(outMeta.width).toBeLessThanOrEqual(1440);
  });

  test('scales up undersized image', async () => {
    const small = await createTestImage('png', 200, 150);
    const { buffer } = await normalizeImage(small, 'http://test/small.png');

    const outMeta = await sharp(buffer).metadata();
    expect(outMeta.width).toBeGreaterThanOrEqual(320);
  });

  test('handles small image with extreme aspect ratio (both scale-up and padding)', async () => {
    // 200x800 = width < MIN_WIDTH (320) AND ratio 0.25 < MIN_RATIO (0.8)
    const img = await createTestImage('png', 200, 800);
    const { buffer } = await normalizeImage(img, 'http://test/small-tall.png');

    const outMeta = await sharp(buffer).metadata();
    expect(outMeta.width).toBeGreaterThanOrEqual(320);
    const ratio = outMeta.width / outMeta.height;
    expect(ratio).toBeGreaterThanOrEqual(0.79);
    expect(outMeta.format).toBe('jpeg');
  });

  test('output buffer is non-empty', async () => {
    const img = await createTestImage('png', 800, 600);
    const { buffer } = await normalizeImage(img, 'http://test/test.png');
    expect(buffer.length).toBeGreaterThan(100);
  });
});

describe('isAcceptableImageUrl', () => {
  test('accepts JPEG URL', () => {
    expect(isAcceptableImageUrl('https://i.redd.it/test.jpg')).toBe(true);
    expect(isAcceptableImageUrl('https://i.redd.it/test.jpeg')).toBe(true);
  });

  test('accepts PNG URL', () => {
    expect(isAcceptableImageUrl('https://i.redd.it/test.png')).toBe(true);
  });

  test('accepts WebP URL', () => {
    expect(isAcceptableImageUrl('https://i.redd.it/test.webp')).toBe(true);
  });

  test('rejects video URLs', () => {
    expect(isAcceptableImageUrl('https://v.redd.it/test.mp4')).toBe(false);
    expect(isAcceptableImageUrl('https://example.com/test.webm')).toBe(false);
  });

  test('rejects GIF URLs', () => {
    expect(isAcceptableImageUrl('https://i.imgur.com/test.gif')).toBe(false);
  });

  test('rejects gallery URLs', () => {
    expect(isAcceptableImageUrl('https://reddit.com/gallery/abc123')).toBe(false);
  });

  test('rejects null/empty/invalid', () => {
    expect(isAcceptableImageUrl(null)).toBe(false);
    expect(isAcceptableImageUrl('')).toBe(false);
    expect(isAcceptableImageUrl(123)).toBe(false);
  });

  test('accepts known image hosts even without extension', () => {
    expect(isAcceptableImageUrl('https://i.redd.it/abc123')).toBe(true);
    expect(isAcceptableImageUrl('https://i.imgur.com/abc123')).toBe(true);
  });
});
