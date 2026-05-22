const Analytics = require('../src/analytics');
const fs = require('fs');
const path = require('path');

const TEST_DIR = path.join(process.cwd(), 'test-data-an');

afterEach(() => {
  if (fs.existsSync(TEST_DIR)) {
    fs.readdirSync(TEST_DIR).forEach((f) =>
      fs.unlinkSync(path.join(TEST_DIR, f))
    );
    fs.rmdirSync(TEST_DIR);
  }
});

describe('Analytics', () => {
  it('should record posts', () => {
    const a = new Analytics({ dataDir: TEST_DIR });
    a.recordPost({ postType: 'funny', keyword: 'memes' });
    expect(a.data.posts.length).toBe(1);
    expect(a.data.posts[0].postType).toBe('funny');
  });

  it('should record errors', () => {
    const a = new Analytics({ dataDir: TEST_DIR });
    a.recordError(new Error('test error'));
    expect(a.data.errors.length).toBe(1);
    expect(a.data.errors[0].message).toBe('test error');
  });

  it('should compute overview', () => {
    const a = new Analytics({ dataDir: TEST_DIR });
    a.recordPost({ postType: 'funny' });
    a.recordPost({ postType: 'hinglish' });
    a.recordError(new Error('fail'));

    const overview = a.getOverview();
    expect(overview.totalPosts).toBe(2);
    expect(overview.postsToday).toBe(2);
    expect(overview.errorsToday).toBe(1);
    expect(overview.successRate).toBeGreaterThan(0);
    expect(overview).toHaveProperty('dailyCounts');
    expect(overview).toHaveProperty('postTypeDistribution');
  });
});
