const logger = require('./logger');

/**
 * A Semaphore-based Concurrency Limiter
 * Restricts the number of tasks executing simultaneously.
 */
class ConcurrencyLimiter {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.activeCount = 0;
    this.queue = [];
  }

  /**
   * Run a task within the concurrency limit
   * @param {Function} taskAsyncFn - A function returning a promise
   * @returns {Promise<any>}
   */
  async run(taskAsyncFn) {
    if (this.activeCount >= this.maxConcurrent) {
      logger.debug({
        activeCount: this.activeCount,
        maxConcurrent: this.maxConcurrent,
        queueLength: this.queue.length,
      }, 'Concurrency limit reached. Queueing task.');
      
      await new Promise((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.activeCount++;
    try {
      return await taskAsyncFn();
    } finally {
      this.activeCount--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next();
      }
    }
  }

  /**
   * Get current concurrency metrics
   */
  getMetrics() {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      max: this.maxConcurrent,
    };
  }
}

module.exports = ConcurrencyLimiter;
