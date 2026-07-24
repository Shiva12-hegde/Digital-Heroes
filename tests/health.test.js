const request = require('supertest');
const app = require('../src/app');
const cacheService = require('../src/services/cacheService');

describe('GET /api/health - Service Health & Telemetry', () => {
  beforeEach(() => {
    cacheService.flush();
  });

  test('1. Should return 200 OK status and correct content type', async () => {
    const res = await request(app)
      .get('/api/health')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(res.body).toHaveProperty('status', 'healthy');
  });

  test('2. Should contain all required system metadata fields', async () => {
    const res = await request(app).get('/api/health');

    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('version', '1.0.0');
    expect(res.body).toHaveProperty('node');
    expect(res.body).toHaveProperty('timestamp');
    expect(typeof res.body.uptime).toBe('number');
  });

  test('3. Should expose cache metrics', async () => {
    const res = await request(app).get('/api/health');

    expect(res.body).toHaveProperty('cache');
    expect(res.body.cache).toHaveProperty('keys');
    expect(res.body.cache).toHaveProperty('hits');
    expect(res.body.cache).toHaveProperty('misses');
  });

  test('4. Should expose concurrency metrics', async () => {
    const res = await request(app).get('/api/health');

    expect(res.body).toHaveProperty('concurrency');
    expect(res.body.concurrency).toHaveProperty('active');
    expect(res.body.concurrency).toHaveProperty('queued');
    expect(res.body.concurrency).toHaveProperty('max');
    expect(res.body.concurrency.max).toBe(2); // Overridden in tests/setup.js
  });
});
