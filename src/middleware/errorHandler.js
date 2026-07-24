const logger = require('../utils/logger');

/**
 * Global Express Error Handling Middleware
 */
function errorHandler(err, req, res, next) {
  const reqLog = req.log || logger;
  const requestId = req.requestId || 'unknown';

  // Log error stack trace
  reqLog.error({
    err: {
      message: err.message,
      stack: err.stack,
      name: err.name,
      ...err
    }
  }, 'Unhandled exception intercepted');

  // Handle JSON parsing errors (e.g. malformed body payloads)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: 'MalformedJson',
      message: 'The request body contains invalid, malformed JSON.',
      requestId,
    });
  }

  // Handle Zod Schema Validation Errors
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'Invalid input parameters provided.',
      requestId,
      details: err.errors.map((e) => ({
        field: e.path.join('.'),
        issue: e.message,
      })),
    });
  }

  // Default Fallback
  const statusCode = err.status || 500;
  const errorCode = err.code || 'InternalServerError';
  const message = statusCode === 500 ? 'An unexpected server error occurred.' : err.message;

  res.status(statusCode).json({
    error: errorCode,
    message,
    requestId,
  });
}

module.exports = errorHandler;
