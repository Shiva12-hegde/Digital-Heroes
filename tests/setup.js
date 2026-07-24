// Overriding configurations for Jest test environment
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.CACHE_TTL = '2';                 // Short 2s cache expiry
process.env.RATE_LIMIT_WINDOW_MS = '2000';   // Short 2s rate limit window
process.env.RATE_LIMIT_MAX = '5';            // Low rate limit trigger threshold (5 requests)
process.env.AUDIT_TIMEOUT_MS = '1000';       // Short 1s request timeout for testing
process.env.MAX_CONCURRENT_AUDITS = '2';     // Low concurrency limit for testing
