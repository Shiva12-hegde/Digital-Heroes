const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Middleware to track requests with unique Correlation IDs
 */
function requestLogger(req, res, next) {
  // Read request ID from header or generate a new one
  const requestId = req.header('x-request-id') || crypto.randomUUID();
  
  // Expose it back to client in response header
  res.setHeader('X-Request-ID', requestId);
  
  // Attach request ID and start timer to req context
  req.requestId = requestId;
  req.startTime = Date.now();

  // Bind logger with request details
  req.log = logger.child({ requestId });

  // Log incoming request
  req.log.info({
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  }, 'Incoming request');

  // Intercept completion to log response details
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    req.log.info({
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      durationMs: duration,
    }, 'Request completed');
  });

  next();
}

module.exports = requestLogger;
