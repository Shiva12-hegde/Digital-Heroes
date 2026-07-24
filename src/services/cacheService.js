const NodeCache = require('node-cache');
const logger = require('../utils/logger');

// Load TTL from environment, fallback to 60 seconds
const defaultTtl = parseInt(process.env.CACHE_TTL || '60', 10);

class CacheService {
  constructor() {
    this.cache = new NodeCache({
      stdTTL: defaultTtl,
      checkperiod: 120,
      useClones: true,
    });

    this.cache.on('expired', (key) => {
      logger.debug({ key }, 'Cache key expired');
    });
  }

  /**
   * Get item from cache along with metadata
   * @param {string} key
   * @returns {object|null}
   */
  get(key) {
    const cachedItem = this.cache.get(key);
    if (!cachedItem) {
      return null;
    }

    const ttlTimestamp = this.cache.getTtl(key);
    let expiresIn = 0;
    if (ttlTimestamp) {
      const now = Date.now();
      expiresIn = Math.max(0, Math.round((ttlTimestamp - now) / 1000));
    }

    return {
      data: cachedItem.data,
      metadata: {
        cached: true,
        cachedAt: cachedItem.cachedAt,
        expiresIn,
      },
    };
  }

  /**
   * Set item in cache
   * @param {string} key
   * @param {any} value
   * @param {number} [ttl] - TTL in seconds
   */
  set(key, value, ttl = defaultTtl) {
    const cacheValue = {
      data: value,
      cachedAt: new Date().toISOString(),
    };
    
    this.cache.set(key, cacheValue, ttl);
    logger.debug({ key, ttl }, 'Cached item set successfully');
  }

  /**
   * Delete item
   */
  del(key) {
    this.cache.del(key);
  }

  /**
   * Flush all items
   */
  flush() {
    this.cache.flushAll();
    logger.info('Cache flushed entirely');
  }

  /**
   * Get stats for health monitoring
   */
  getStats() {
    return this.cache.getStats();
  }
}

// Export a single instance
module.exports = new CacheService();
