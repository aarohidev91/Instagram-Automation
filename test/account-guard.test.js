const AccountGuard = require('../src/account-guard');
const fs = require('fs');
const path = require('path');

const TEST_DIR = path.join(process.cwd(), 'test-data-ag');

afterEach(() => {
  if (fs.existsSync(TEST_DIR)) {
    fs.readdirSync(TEST_DIR).forEach((f) =>
      fs.unlinkSync(path.join(TEST_DIR, f))
    );
    fs.rmdirSync(TEST_DIR);
  }
});

describe('AccountGuard', () => {
  it('should allow posting during active hours', () => {
    const hour = new Date().getHours();
    const guard = new AccountGuard({
      dataDir: TEST_DIR,
      activeHoursStart: 0,
      activeHoursEnd: 24,
      timezone: 'UTC',
    });
    const check = guard.canPost();
    expect(check.allowed).toBe(true);
  });

  it('should track consecutive errors', () => {
    const guard = new AccountGuard({
      dataDir: TEST_DIR,
      maxConsecutiveErrors: 3,
    });
    guard.recordError('test error');
    guard.recordError('test error');
    expect(guard.state.consecutiveErrors).toBe(2);
  });

  it('should enter safe mode on checkpoint', () => {
    const guard = new AccountGuard({ dataDir: TEST_DIR });
    guard.recordError('checkpoint required');
    expect(guard.state.checkpointCount).toBe(1);
    const check = guard.canPost();
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe('safe_mode');
  });

  it('should reset errors on success', () => {
    const guard = new AccountGuard({ dataDir: TEST_DIR });
    guard.recordError('err');
    guard.recordError('err');
    guard.recordSuccess();
    expect(guard.state.consecutiveErrors).toBe(0);
    expect(guard.state.totalPosts).toBe(1);
  });

  it('should expose stats', () => {
    const guard = new AccountGuard({ dataDir: TEST_DIR });
    const stats = guard.getStats();
    expect(stats).toHaveProperty('daysSinceFirstRun');
    expect(stats).toHaveProperty('warmUpMultiplier');
    expect(stats).toHaveProperty('totalPosts');
  });
});
