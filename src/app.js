const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const { z } = require('zod');

const requestLogger = require('./middleware/requestLogger');
const rateLimiter = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const auditService = require('./services/auditService');
const cacheService = require('./services/cacheService');

const app = express();

// Pretty-print JSON responses for direct browser inspection
app.set('json spaces', 2);

// Apply production security headers (Helmet)
// Adjust Content Security Policy to allow styling/fonts/scripts in our local dashboard
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      "style-src": ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "cdn.jsdelivr.net"],
      "font-src": ["'self'", "fonts.gstatic.com"],
      "img-src": ["'self'", "data:", "https:"],
      "connect-src": ["'self'"]
    }
  }
}));

// Enable Cross-Origin Resource Sharing (CORS)
app.use(cors());

// Enable gzip response compression
app.use(compression());

// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets from public folder
app.use(express.static('public'));

// Assign Request / Correlation IDs and log requests
app.use(requestLogger);

// --- Swagger Configuration ---
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Page Pulse API',
      version: '1.0.0',
      description: 'Production-ready URL Auditing Service with SEO, TLS, and Performance inspection capabilities.',
      contact: {
        name: 'Digital Heroes SDE',
        url: 'https://digitalheroesco.com'
      }
    },
    servers: [
      {
        url: '/',
        description: 'Current Environment Host'
      }
    ]
  },
  apis: ['./src/app.js'] // Look for annotations in app.js
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Zod payload validation schema
const auditPayloadSchema = z.object({
  url: z.string({
    required_error: 'URL is required',
    invalid_type_error: 'URL must be a string'
  })
  .trim()
  .min(1, 'URL cannot be empty')
  .refine((val) => {
    try {
      // Append https:// if protocol is missing to validate format
      const checkVal = /^https?:\/\//i.test(val) ? val : 'https://' + val;
      const parsed = new URL(checkVal);
      // Ensure host has a valid format (e.g. contains a TLD or domain name)
      return parsed.hostname.includes('.') && parsed.hostname.length > 3;
    } catch {
      return false;
    }
  }, { message: 'Provide a valid target URL structure (e.g. google.com or https://example.com)' })
});

/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: Retrieve service health and telemetry metadata
 *     description: Returns system availability status, node version, uptime, cache metrics, and concurrency queues.
 *     responses:
 *       200:
 *         description: System is healthy and operational.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: healthy
 *                 uptime:
 *                   type: number
 *                   example: 124.52
 *                 cache:
 *                   type: object
 *                   properties:
 *                     keys:
 *                       type: number
 *                       example: 4
 *                     hits:
 *                       type: number
 *                       example: 12
 *                     misses:
 *                       type: number
 *                       example: 2
 *                 version:
 *                   type: string
 *                   example: 1.0.0
 *                 node:
 *                   type: string
 *                   example: v22.4.0
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 concurrency:
 *                   type: object
 *                   properties:
 *                     active:
 *                       type: number
 *                       example: 1
 *                     queued:
 *                       type: number
 *                       example: 0
 *                     max:
 *                       type: number
 *                       example: 10
 */
app.get('/api/health', (req, res) => {
  const stats = cacheService.getStats();
  const limiterMetrics = auditService.getLimiterMetrics();

  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    cache: {
      keys: stats.keys,
      hits: stats.hits,
      misses: stats.misses
    },
    version: '1.0.0',
    node: process.version,
    timestamp: new Date().toISOString(),
    concurrency: limiterMetrics
  });
});

/**
 * @openapi
 * /api/audit:
 *   post:
 *     summary: Request an audit for a destination URL
 *     description: Audits target HTTP(S) responses, verifies TLS certificate statuses, and parses SEO tags.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *             properties:
 *               url:
 *                 type: string
 *                 description: The URL target to audit (e.g. "https://example.com" or "example.com")
 *                 example: "https://example.com"
 *     responses:
 *       200:
 *         description: Audit completed successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                 http:
 *                   type: object
 *                 security:
 *                   type: object
 *                 seo:
 *                   type: object
 *                 performance:
 *                   type: object
 *                 scores:
 *                   type: object
 *                 cache:
 *                   type: object
 *       400:
 *         description: Validation error or malformed payload.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Unhandled internal system error.
 */
app.post('/api/audit', rateLimiter, async (req, res, next) => {
  try {
    // Validate request body
    const body = auditPayloadSchema.parse(req.body);
    
    // Perform URL Audit
    const result = await auditService.audit(body.url, {
      requestId: req.requestId
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Fallback 404 Route Handler
app.use((req, res) => {
  res.status(404).json({
    error: 'RouteNotFound',
    message: `Cannot ${req.method} ${req.url}. Visit /api/docs for API details.`,
    requestId: req.requestId
  });
});

// Apply Global Error Handling Middleware
app.use(errorHandler);

module.exports = app;
