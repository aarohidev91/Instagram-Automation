const utilities = require('../src/utils');
const fs = require('fs');
const path = require('path');

describe('Utilities', () => {
  afterEach(() => {
    // Clean up test artefacts
    const logDir = path.join(process.cwd(), 'logs');
    if (fs.existsSync(logDir)) {
      fs.readdirSync(logDir).forEach((f) =>
        fs.unlinkSync(path.join(logDir, f))
      );
      fs.rmdirSync(logDir);
    }
  });

  describe('delay', () => {
    it('should delay for the specified time', async () => {
      const start = Date.now();
      await utilities.delay(100);
      const end = Date.now();
      expect(end - start).toBeGreaterThanOrEqual(90);
    });
  });

  describe('logToFile', () => {
    it('should log message to file and console', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      utilities.logToFile('Test message');

      expect(consoleSpy).toHaveBeenCalled();
      const logFile = path.join(process.cwd(), 'logs', 'bot.log');
      expect(fs.existsSync(logFile)).toBe(true);

      const content = fs.readFileSync(logFile, 'utf8');
      expect(content).toContain('Test message');
      expect(content).toContain('[INFO]');

      consoleSpy.mockRestore();
    });
  });

  describe('cleanupFile', () => {
    it('should remove existing file', () => {
      const testFile = path.join(process.cwd(), 'test-cleanup.txt');
      fs.writeFileSync(testFile, 'test content');

      expect(fs.existsSync(testFile)).toBe(true);
      utilities.cleanupFile(testFile);
      expect(fs.existsSync(testFile)).toBe(false);
    });

    it('should handle non-existent file gracefully', () => {
      expect(() => {
        utilities.cleanupFile('non-existent-file.txt');
      }).not.toThrow();
    });
  });

  describe('validateImage', () => {
    it('should reject non-existent files', () => {
      const result = utilities.validateImage('/tmp/does-not-exist.jpg');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('should reject files smaller than 10 KB', () => {
      const tmpFile = path.join(process.cwd(), 'test-tiny.jpg');
      fs.writeFileSync(tmpFile, 'x'.repeat(100));
      const result = utilities.validateImage(tmpFile);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('too_small');
      fs.unlinkSync(tmpFile);
    });

    it('should accept valid-size files', () => {
      const tmpFile = path.join(process.cwd(), 'test-valid.jpg');
      fs.writeFileSync(tmpFile, 'x'.repeat(20 * 1024));
      const result = utilities.validateImage(tmpFile);
      expect(result.valid).toBe(true);
      fs.unlinkSync(tmpFile);
    });
  });

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(utilities.formatDuration(5000)).toBe('5s');
    });

    it('should format minutes', () => {
      expect(utilities.formatDuration(120000)).toBe('2m');
    });

    it('should format hours', () => {
      expect(utilities.formatDuration(7200000)).toBe('2.0h');
    });
  });

  describe('retry', () => {
    it('should succeed on first try', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      const result = await utilities.retry(fn, 3, 10);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('ok');
      const result = await utilities.retry(fn, 3, 10);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw after max retries', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('always fails'));
      await expect(utilities.retry(fn, 2, 10)).rejects.toThrow(
        'always fails'
      );
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('readJSON / writeJSON', () => {
    it('should round-trip JSON', () => {
      const tmpFile = path.join(process.cwd(), 'test-json.json');
      const data = { foo: 'bar', num: 42 };
      utilities.writeJSON(tmpFile, data);
      const loaded = utilities.readJSON(tmpFile);
      expect(loaded).toEqual(data);
      fs.unlinkSync(tmpFile);
    });

    it('should return default on missing file', () => {
      const result = utilities.readJSON('/tmp/nope.json', { x: 1 });
      expect(result).toEqual({ x: 1 });
    });
  });
});
