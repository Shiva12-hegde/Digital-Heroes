const request = require('supertest');
const axios = require('axios');
const app = require('../src/app');
const cacheService = require('../src/services/cacheService');
const sslService = require('../src/services/sslService');

// Mock external systems to make tests independent of network state
jest.mock('axios');
jest.mock('../src/services/sslService');

describe('POST /api/audit - URL Audit Service', () => {
  let mockAxiosGet;
  let mockUse;

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();

    // Default SSL Service Mock
    sslService.getSSLDetails.mockResolvedValue({
      https: true,
      sslExpiryDays: 90,
      issuer: "Let's Encrypt",
      subject: 'example.com',
      validFrom: '2026-06-01T00:00:00.000Z',
      validTo: '2026-09-01T00:00:00.000Z',
      protocol: 'TLSv1.3',
      authorized: true,
      authorizationError: null
    });

    // Default Axios Interceptors & Get Mock
    mockUse = jest.fn();
    mockAxiosGet = jest.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-length': '120',
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'x-frame-options': 'DENY'
      },
      data: '<html lang="en"><head><title>Test Title Page</title><meta name="description" content="Test description content that has sufficient length."></head><body><h1>Main Title Heading</h1><img src="logo.png" alt="Company Logo"></body></html>',
      request: {
        _redirectable: { _redirectCount: 0 }
      }
    });

    axios.create.mockReturnValue({
      get: mockAxiosGet,
      interceptors: {
        request: { use: mockUse }
      }
    });
  });

  // --- 1. Input Validation & Error Routing ---

  test('1. Should return 400 if payload body is empty', async () => {
    const res = await request(app)
      .post('/api/audit')
      .send({})
      .expect(400);

    expect(res.body.error).toBe('ValidationError');
    expect(res.body.details[0].field).toBe('url');
  });

  test('2. Should return 400 if URL property is missing', async () => {
    const res = await request(app)
      .post('/api/audit')
      .send({ website: 'https://google.com' })
      .expect(400);

    expect(res.body.error).toBe('ValidationError');
  });

  test('3. Should return 400 if URL format is invalid', async () => {
    const res = await request(app)
      .post('/api/audit')
      .send({ url: 'not_a_valid_domain' })
      .expect(400);

    expect(res.body.error).toBe('ValidationError');
    expect(res.body.details[0].issue).toContain('Provide a valid target URL structure');
  });

  test('4. Should return 400 if URL is not a string type', async () => {
    const res = await request(app)
      .post('/api/audit')
      .send({ url: 12345 })
      .expect(400);

    expect(res.body.error).toBe('ValidationError');
  });

  test('5. Should return 404 for invalid API routes', async () => {
    const res = await request(app)
      .get('/api/invalid-endpoint-path')
      .expect(404);

    expect(res.body.error).toBe('RouteNotFound');
  });

  test('6. Should return 400 for malformed JSON request bodies', async () => {
    const res = await request(app)
      .post('/api/audit')
      .set('Content-Type', 'application/json')
      .send('{"url": "google.com",}') // dangling comma makes it malformed
      .expect(400);

    expect(res.body.error).toBe('MalformedJson');
  });

  // --- 2. Request Correlation IDs ---

  test('7. Should attach and return X-Request-ID response header', async () => {
    const res = await request(app)
      .post('/api/audit')
      .send({ url: 'google.com' })
      .expect(200);

    expect(res.headers).toHaveProperty('x-request-id');
    expect(res.body.cache.cached).toBe(false);
  });

  // --- 3. Caching Functionality ---

  test('8. Cache Miss: First audit should fetch fresh content', async () => {
    const res = await request(app)
      .post('/api/audit')
      .send({ url: 'cache-test.com' })
      .expect(200);

    expect(res.body.cache.cached).toBe(false);
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
  });

  test('9. Cache Hit: Second audit should return cached content without HTTP requests', async () => {
    // 1st request
    await request(app)
      .post('/api/audit')
      .send({ url: 'cache-test.com' });

    // 2nd request
    const res = await request(app)
      .post('/api/audit')
      .send({ url: 'cache-test.com' })
      .expect(200);

    expect(res.body.cache.cached).toBe(true);
    expect(res.body.cache).toHaveProperty('expiresIn');
    expect(res.body.cache).toHaveProperty('cachedAt');
    expect(mockAxiosGet).toHaveBeenCalledTimes(1); // Still 1 call due to caching
  });

  test('10. Cache Flushing: Flushed keys should force a cache miss', async () => {
    await request(app).post('/api/audit').send({ url: 'cache-test.com' });
    
    cacheService.flush();

    const res = await request(app)
      .post('/api/audit')
      .send({ url: 'cache-test.com' })
      .expect(200);

    expect(res.body.cache.cached).toBe(false);
    expect(mockAxiosGet).toHaveBeenCalledTimes(2);
  });

  // --- 4. Rate Limiting ---

  test('11. Rate Limiting: Should block client after 5 successive requests', async () => {
    // Low threshold is 5 (defined in tests/setup.js)
    // Send 5 requests successfully
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/audit')
        .set('x-test-rate-limit', 'true')
        .send({ url: `limiter-${i}.com` })
        .expect(200);
    }

    // 6th request triggers rate limit
    const res = await request(app)
      .post('/api/audit')
      .set('x-test-rate-limit', 'true')
      .send({ url: 'limiter-trigger.com' })
      .expect(429);

    expect(res.body.error).toBe('RateLimitExceeded');
    expect(res.body.message).toContain('Too many requests');
  });

  // --- 5. Auditing Scores & Analysis ---

  test('12. Should calculate high scores for well-optimized websites', async () => {
    const res = await request(app)
      .post('/api/audit')
      .send({ url: 'optimized.com' })
      .expect(200);

    expect(res.body.scores.seo).toBeGreaterThanOrEqual(85);
    expect(res.body.scores.accessibility).toBeGreaterThanOrEqual(85);
    expect(res.body.scores.bestPractices).toBeGreaterThanOrEqual(80);
    expect(res.body.scores.performance).toBeGreaterThanOrEqual(80);
  });

  test('13. Should calculate low scores for poorly optimized websites', async () => {
    // Poor quality HTML: no title, no description, multiple H1s, missing alt tags
    mockAxiosGet.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: '<html><body><h1>First H1</h1><h1>Second H1</h1><img src="a.png"><img src="b.png"></body></html>',
      request: { _redirectable: { _redirectCount: 0 } }
    });

    const res = await request(app)
      .post('/api/audit')
      .send({ url: 'poor-site.com' })
      .expect(200);

    // Assert that scores are downgraded
    expect(res.body.scores.seo).toBeLessThan(50);
    expect(res.body.scores.accessibility).toBeLessThan(50);
  });

  test('14. Should report network unreachable failures cleanly instead of throwing 500', async () => {
    // Mock Axios throwing network connection error
    const connectionError = new Error('getaddrinfo ENOTFOUND host.com');
    connectionError.code = 'ENOTFOUND';
    mockAxiosGet.mockRejectedValueOnce(connectionError);

    // Mock SSL failing for unreachable domain
    sslService.getSSLDetails.mockResolvedValueOnce({
      https: false,
      sslExpiryDays: null,
      error: 'Connection refused'
    });

    const res = await request(app)
      .post('/api/audit')
      .send({ url: 'unreachable-host.com' })
      .expect(200);

    expect(res.body.http.status).toBeNull();
    expect(res.body.http.error).toContain('ENOTFOUND');
    expect(res.body.scores.average).toBeLessThan(20);
  });

  test('15. Should audit pages returning 404 status codes successfully', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      status: 404,
      statusText: 'Not Found',
      headers: {},
      data: '<html><head><title>404 Page</title></head><body><h1>Not Found</h1></body></html>',
      request: { _redirectable: { _redirectCount: 0 } }
    });

    const res = await request(app)
      .post('/api/audit')
      .send({ url: 'broken-link.com' })
      .expect(200);

    expect(res.body.http.status).toBe(404);
    expect(res.body.http.statusText).toBe('Not Found');
  });

  test('16. Should capture redirect history counters', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      status: 200,
      headers: {},
      data: '<html><head><title>Target Page</title></head></html>',
      request: {
        _redirectable: { _redirectCount: 2 } // Mock 2 redirects followed
      }
    });

    const res = await request(app)
      .post('/api/audit')
      .send({ url: 'redirect-loop.com' })
      .expect(200);

    expect(res.body.http.redirects).toBe(2);
  });

  test('17. Should grade non-HTTPS target sites lower on Best Practices', async () => {
    sslService.getSSLDetails.mockResolvedValueOnce({
      https: false,
      sslExpiryDays: null,
      error: 'Not HTTPS'
    });

    const res = await request(app)
      .post('/api/audit')
      .send({ url: 'http://insecure-site.com' })
      .expect(200);

    expect(res.body.security.https).toBe(false);
    expect(res.body.scores.bestPractices).toBeLessThan(70);
  });

  test('18. Concurrency: Check concurrency metrics tracking', () => {
    const metrics = app.get ? require('../src/services/auditService').getLimiterMetrics() : null;
    expect(metrics).toBeDefined();
    expect(metrics).toHaveProperty('active');
    expect(metrics).toHaveProperty('queued');
  });
});
