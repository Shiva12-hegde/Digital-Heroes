const rateLimit = require('express-rate-limit');

// Load environment configurations
const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
const max = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);

const limiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false,  // Disable legacy headers
  skip: (req) => {
    // Skip rate limiting during testing unless we explicitly want to test it
    if (process.env.NODE_ENV === 'test') {
      return !req.headers['x-test-rate-limit'];
    }
    return false;
  },
  handler: (req, res) => {
    if (req.log) {
      req.log.warn({ ip: req.ip, limit: max, windowMs }, 'Rate limit exceeded by client IP');
    }
    
    // Calculate seconds remaining until window resets
    const secondsRemaining = req.rateLimit.resetTime 
      ? Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000) 
      : Math.ceil(windowMs / 1000);

    res.status(429).json({
      error: 'RateLimitExceeded',
      message: `Too many requests from this IP. Please try again in ${secondsRemaining} seconds.`,
      requestId: req.requestId,
    });
  },
});

module.exports = limiter;
