const RateLimiter = require('../src/rate-limiter');
const fs = require('fs');
const path = require('path');

const TEST_DIR = path.join(process.cwd(), 'test-data-rl');

afterEach(() => {
  if (fs.existsSync(TEST_DIR)) {
    fs.readdirSync(TEST_DIR).forEach((f) =>
      fs.unlinkSync(path.join(TEST_DIR, f))
    );
    fs.rmdirSync(TEST_DIR);
  }
});

describe('RateLimiter', () => {
  it('should allow posting when no limits hit', () => {
    const rl = new RateLimiter({ dataDir: TEST_DIR });
    const check = rl.canPost();
    expect(check.allowed).toBe(true);
  });

  it('should block after daily limit', () => {
    const rl = new RateLimiter({ dataDir: TEST_DIR, postsPerDay: 2 });
    rl.recordPost();
    rl.recordPost();
    const check = rl.canPost();
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe('daily_limit');
  });

  it('should enforce min post interval', () => {
    const rl = new RateLimiter({
      dataDir: TEST_DIR,
      minPostInterval: 60000,
      postsPerHour: 10,
    });
    rl.recordPost();
    const check = rl.canPost();
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe('min_interval');
  });

  it('should respect cooldown', () => {
    const rl = new RateLimiter({ dataDir: TEST_DIR });
    rl.setCooldown(60000);
    const check = rl.canAct();
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe('cooldown');
  });

  it('should generate random delays within range', () => {
    const rl = new RateLimiter({
      dataDir: TEST_DIR,
      minPostInterval: 10000,
      maxPostInterval: 20000,
    });
    const delay = rl.getRandomPostDelay();
    expect(delay).toBeGreaterThanOrEqual(10000);
    expect(delay).toBeLessThanOrEqual(20000);
  });

  it('should expose stats', () => {
    const rl = new RateLimiter({ dataDir: TEST_DIR });
    const stats = rl.getStats();
    expect(stats).toHaveProperty('postsToday');
    expect(stats).toHaveProperty('limits');
  });
});
