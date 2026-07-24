// Load environment variables before importing app
require('dotenv').config();

const app = require('./app');
const logger = require('./utils/logger');

const port = parseInt(process.env.PORT || '3000', 10);

const server = app.listen(port, () => {
  logger.info({
    port,
    nodeEnv: process.env.NODE_ENV || 'development',
    version: process.versions.node
  }, '🚀 Page Pulse service is running and listening');
});

// Graceful shutdown handling
const shutdown = (signal) => {
  logger.info({ signal }, 'Graceful shutdown triggered. Closing HTTP server.');
  server.close(() => {
    logger.info('HTTP server closed. Exiting process.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
