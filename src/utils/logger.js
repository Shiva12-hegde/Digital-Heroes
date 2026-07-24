const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const transportConfig = !isProduction && !isTest
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

const logger = pino({
  level: isTest ? 'silent' : process.env.LOG_LEVEL || 'info',
  transport: transportConfig,
  base: isProduction ? { pid: process.pid } : undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
