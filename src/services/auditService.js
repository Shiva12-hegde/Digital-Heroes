const axios = require('axios');
const cheerio = require('cheerio');
const ConcurrencyLimiter = require('../utils/concurrencyLimiter');
const cacheService = require('./cacheService');
const sslService = require('./sslService');
const logger = require('../utils/logger');

// Load environment variables with defaults
const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_AUDITS || '10', 10);
const timeoutMs = parseInt(process.env.AUDIT_TIMEOUT_MS || '5000', 10);
const defaultTtl = parseInt(process.env.CACHE_TTL || '60', 10);

// Initialize a single global concurrency limiter for audits
const limiter = new ConcurrencyLimiter(maxConcurrent);

class AuditService {
  /**
   * Helper to format content length into human readable sizes
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Normalize URLs, prepending https:// if protocol is missing
   * @param {string} urlString
   * @returns {string}
   */
  normalizeUrl(urlString) {
    let target = urlString.trim();
    if (!/^https?:\/\//i.test(target)) {
      target = 'https://' + target;
    }
    return target;
  }

  /**
   * Audit a URL
   * @param {string} rawUrl - Target URL string
   * @param {object} reqContext - Logs request ID context
   * @returns {Promise<object>} Audit report payload
   */
  async audit(rawUrl, reqContext = {}) {
    const url = this.normalizeUrl(rawUrl);
    const requestId = reqContext.requestId || 'unknown';

    logger.info({ requestId, url }, 'Initiating URL audit');

    // 1. Check Cache
    const cachedResult = cacheService.get(url);
    if (cachedResult) {
      logger.info({ requestId, url }, 'Cache hit. Returning cached audit report.');
      return {
        ...cachedResult.data,
        cache: cachedResult.metadata,
      };
    }

    logger.debug({ requestId, url }, 'Cache miss. Queuing request in concurrency limiter.');

    // 2. Execute Audit within Concurrency Limit
    const report = await limiter.run(async () => {
      const startTime = Date.now();
      let response;
      let responseTime = 0;
      let htmlContent = '';
      let contentLength = 0;
      let redirectCount = 0;
      let httpError = null;

      const axiosInstance = axios.create({
        timeout: timeoutMs,
        maxRedirects: 5,
        headers: {
          'User-Agent': 'PagePulseURLAuditor/1.0 (+https://digitalheroesco.com)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        validateStatus: () => true, // Audit responses even if they return 4xx/5xx status
      });

      // Capture redirects
      axiosInstance.interceptors.request.use((config) => {
        config.metadata = { startTime: Date.now() };
        return config;
      });

      try {
        response = await axiosInstance.get(url);
        responseTime = Date.now() - startTime;
        
        // Extract redirects
        if (response.request && response.request._redirectable) {
          redirectCount = response.request._redirectable._redirectCount || 0;
        }

        htmlContent = typeof response.data === 'string' ? response.data : '';
        contentLength = htmlContent.length;

        // If content-length header exists, prefer it
        const headerLength = response.headers['content-length'];
        if (headerLength) {
          contentLength = parseInt(headerLength, 10);
        }
      } catch (err) {
        responseTime = Date.now() - startTime;
        logger.warn({ requestId, url, error: err.message }, 'HTTP request failed during audit');
        
        // Handle common network errors cleanly in report instead of crashing the endpoint
        httpError = {
          code: err.code || 'UNKNOWN_ERROR',
          message: err.message,
        };
      }

      // 3. Gather SSL/TLS details
      const ssl = await sslService.getSSLDetails(url);

      // 4. Parse HTML and Calculate Scores (Pulse Light Audit Engine)
      const auditData = this.runPulseLightEngine({
        url,
        response,
        responseTime,
        htmlContent,
        contentLength,
        redirectCount,
        ssl,
        httpError,
      });

      return auditData;
    });

    // 5. Save to Cache
    cacheService.set(url, report, defaultTtl);

    return {
      ...report,
      cache: {
        cached: false,
        cachedAt: null,
        expiresIn: null,
      },
    };
  }

  /**
   * Run the Pulse Light Audit Engine on page payload
   */
  runPulseLightEngine({
    url,
    response,
    responseTime,
    htmlContent,
    contentLength,
    redirectCount,
    ssl,
    httpError,
  }) {
    // Default variables if page is unreachable
    if (httpError) {
      return {
        url,
        http: {
          status: null,
          statusText: 'Unreachable',
          responseTime,
          redirects: redirectCount,
          error: httpError.message,
          headers: {},
        },
        security: ssl,
        seo: {
          title: false,
          titleContent: null,
          metaDescription: false,
          metaDescriptionContent: null,
          h1Count: 0,
          missingAltImages: 0,
          canonical: false,
        },
        performance: {
          contentLength: '0 B',
          htmlSize: 0,
          scriptCount: 0,
          cssCount: 0,
          responseTimeMs: responseTime,
        },
        scores: {
          seo: 0,
          accessibility: 0,
          bestPractices: ssl.https ? 40 : 0,
          performance: 0,
          average: ssl.https ? 10 : 0,
        },
      };
    }

    const $ = cheerio.load(htmlContent);

    // --- HTTP Header parsing ---
    const headers = response.headers || {};
    const serverHeader = headers['server'] || 'Unknown';
    const contentTypeHeader = headers['content-type'] || 'text/html';

    // --- SEO Elements ---
    const titleTag = $('title').first();
    const titleText = titleTag.text().trim();
    const hasTitle = titleText.length > 0;
    const isTitleOptimized = titleText.length >= 10 && titleText.length <= 70;

    const metaDescTag = $('meta[name="description"]').first();
    const metaDescText = metaDescTag.attr('content') ? metaDescTag.attr('content').trim() : '';
    const hasMetaDescription = metaDescText.length > 0;
    const isMetaOptimized = metaDescText.length >= 50 && metaDescText.length <= 160;

    const h1Tags = $('h1');
    const h1Count = h1Tags.length;

    const canonicalTag = $('link[rel="canonical"]').first();
    const hasCanonical = canonicalTag.attr('href') !== undefined;

    // --- Images Alt attribute checks ---
    const images = $('img');
    let totalImages = images.length;
    let missingAltImages = 0;
    images.each((_, el) => {
      const alt = $(el).attr('alt');
      if (alt === undefined || alt.trim() === '') {
        missingAltImages++;
      }
    });

    // --- Accessibility Checks ---
    const htmlLang = $('html').attr('lang') || '';
    const hasLang = htmlLang.trim().length > 0;

    // Associated Form Labels
    const inputs = $('input[type="text"], input[type="search"], input[type="email"], input[type="tel"]');
    let unlabelledInputs = 0;
    inputs.each((_, el) => {
      const id = $(el).attr('id');
      const ariaLabel = $(el).attr('aria-label');
      const ariaLabelledby = $(el).attr('aria-labelledby');
      
      if (!ariaLabel && !ariaLabelledby) {
        if (id) {
          const matchingLabel = $(`label[for="${id}"]`);
          if (matchingLabel.length === 0) {
            unlabelledInputs++;
          }
        } else {
          unlabelledInputs++;
        }
      }
    });

    // Interactive element checks
    const buttons = $('button, a.btn, input[type="button"], input[type="submit"]');
    let poorlyAriaLabeledButtons = 0;
    buttons.each((_, el) => {
      const text = $(el).text().trim();
      const val = $(el).attr('value') || '';
      const aria = $(el).attr('aria-label') || '';
      if (!text && !val && !aria) {
        poorlyAriaLabeledButtons++;
      }
    });

    // --- Best Practices Checks ---
    const links = $('a');
    let unsafeExternalLinks = 0;
    links.each((_, el) => {
      const href = $(el).attr('href') || '';
      const target = $(el).attr('target') || '';
      const rel = $(el).attr('rel') || '';
      
      // External URL and target=_blank
      if (/^https?:\/\//i.test(href) && target.toLowerCase() === '_blank') {
        const isSafe = rel.includes('noopener') || rel.includes('noreferrer');
        if (!isSafe) {
          unsafeExternalLinks++;
        }
      }
    });

    // Check security headers on destination response
    const hasHsts = !!headers['strict-transport-security'];
    const hasXFrame = !!headers['x-frame-options'];
    const hasCsp = !!headers['content-security-policy'];

    // --- Performance items ---
    const scriptTags = $('script[src]');
    const scriptCount = scriptTags.length;

    const stylesheetLinks = $('link[rel="stylesheet"]');
    const cssCount = stylesheetLinks.length;

    // --- SCORE CALCULATIONS ---

    // SEO Score (out of 100)
    let seoScore = 0;
    if (hasTitle) seoScore += 25;
    if (isTitleOptimized) seoScore += 10;
    if (hasMetaDescription) seoScore += 25;
    if (isMetaOptimized) seoScore += 10;
    if (h1Count === 1) seoScore += 20;
    else if (h1Count > 1) seoScore += 10; // penalize too many H1s
    if (hasCanonical) seoScore += 10;
    
    // Deduct slightly for missing alt images
    if (totalImages > 0 && missingAltImages > 0) {
      const missingRatio = missingAltImages / totalImages;
      const deduction = Math.round(missingRatio * 10);
      seoScore = Math.max(0, seoScore - deduction);
    } else if (totalImages > 0 && missingAltImages === 0) {
      // Bonus for fully accessible images
      seoScore = Math.min(100, seoScore + 5);
    }

    // Accessibility Score (out of 100)
    let accessScore = 0;
    if (hasLang) accessScore += 30;
    
    // Alt tags
    if (totalImages === 0) {
      accessScore += 30; // perfect alt check if no images
    } else {
      const altRatio = (totalImages - missingAltImages) / totalImages;
      accessScore += Math.round(altRatio * 30);
    }

    // Label inputs
    const totalInputs = inputs.length;
    if (totalInputs === 0) {
      accessScore += 20;
    } else {
      const labelRatio = (totalInputs - unlabelledInputs) / totalInputs;
      accessScore += Math.round(labelRatio * 20);
    }

    // Interactive names
    const totalButtons = buttons.length;
    if (totalButtons === 0) {
      accessScore += 20;
    } else {
      const btnRatio = (totalButtons - poorlyAriaLabeledButtons) / totalButtons;
      accessScore += Math.round(btnRatio * 20);
    }

    // Best Practices Score (out of 100)
    let bestPracticesScore = 0;
    if (ssl.https) bestPracticesScore += 40; // HTTPS is fundamental
    
    // External link safety
    const totalExternalLinks = links.filter((_, el) => {
      const href = $(el).attr('href') || '';
      return /^https?:\/\//i.test(href) && $(el).attr('target') === '_blank';
    }).length;

    if (totalExternalLinks === 0) {
      bestPracticesScore += 30;
    } else {
      const safeRatio = (totalExternalLinks - unsafeExternalLinks) / totalExternalLinks;
      bestPracticesScore += Math.round(safeRatio * 30);
    }

    // Security Headers check
    if (hasHsts) bestPracticesScore += 10;
    if (hasXFrame) bestPracticesScore += 10;
    if (hasCsp) bestPracticesScore += 10;

    // Performance Score (out of 100)
    let perfScore = 0;
    // 1. Response Time (up to 40 pts)
    if (responseTime < 300) perfScore += 40;
    else if (responseTime < 800) perfScore += 30;
    else if (responseTime < 1500) perfScore += 20;
    else if (responseTime < 3000) perfScore += 10;

    // 2. HTML Size weight (up to 30 pts)
    const kbSize = contentLength / 1024;
    if (kbSize < 50) perfScore += 30;
    else if (kbSize < 200) perfScore += 20;
    else if (kbSize < 500) perfScore += 10;
    else perfScore += 5;

    // 3. Script Bloat (up to 15 pts)
    if (scriptCount < 5) perfScore += 15;
    else if (scriptCount < 15) perfScore += 10;
    else if (scriptCount < 30) perfScore += 5;

    // 4. Stylesheet Bloat (up to 15 pts)
    if (cssCount < 3) perfScore += 15;
    else if (cssCount < 8) perfScore += 10;
    else if (cssCount < 15) perfScore += 5;

    // Average Score
    const average = Math.round((seoScore + accessScore + bestPracticesScore + perfScore) / 4);

    return {
      url,
      http: {
        status: response.status,
        statusText: response.statusText,
        responseTime,
        redirects: redirectCount,
        headers: {
          server: serverHeader,
          contentType: contentTypeHeader,
        },
      },
      security: ssl,
      seo: {
        title: hasTitle,
        titleContent: hasTitle ? titleText : null,
        metaDescription: hasMetaDescription,
        metaDescriptionContent: hasMetaDescription ? metaDescText : null,
        h1Count,
        missingAltImages,
        canonical: hasCanonical,
      },
      performance: {
        contentLength: this.formatBytes(contentLength),
        htmlSize: contentLength,
        scriptCount,
        cssCount,
        responseTimeMs: responseTime,
      },
      scores: {
        seo: seoScore,
        accessibility: accessScore,
        bestPractices: bestPracticesScore,
        performance: perfScore,
        average,
      },
    };
  }

  /**
   * Get active concurrency limiter stats
   */
  getLimiterMetrics() {
    return limiter.getMetrics();
  }
}

module.exports = new AuditService();
