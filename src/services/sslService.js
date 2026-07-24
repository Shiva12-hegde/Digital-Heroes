const tls = require('tls');
const { URL } = require('url');
const logger = require('../utils/logger');

class SSLService {
  /**
   * Fetches SSL Certificate details for a given URL
   * @param {string} urlString - The full URL to audit
   * @returns {Promise<object|null>}
   */
  async getSSLDetails(urlString) {
    try {
      const parsedUrl = new URL(urlString);
      
      // SSL only applies to HTTPS
      if (parsedUrl.protocol !== 'https:') {
        return {
          https: false,
          sslExpiryDays: null,
          error: 'Not an HTTPS endpoint'
        };
      }

      const hostname = parsedUrl.hostname;

      return new Promise((resolve) => {
        const socket = tls.connect({
          host: hostname,
          port: 443,
          servername: hostname, // Enable Server Name Indication (SNI)
          rejectUnauthorized: false, // Don't throw on expired/self-signed certs so we can inspect them
        }, () => {
          const cert = socket.getPeerCertificate(true);
          
          if (!cert || Object.keys(cert).length === 0) {
            socket.destroy();
            return resolve({
              https: true,
              sslExpiryDays: null,
              error: 'No peer certificate returned'
            });
          }

          const validTo = new Date(cert.valid_to);
          const validFrom = new Date(cert.valid_from);
          const now = new Date();
          
          // Calculate remaining days
          const diffTime = validTo.getTime() - now.getTime();
          const sslExpiryDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          const details = {
            https: true,
            sslExpiryDays: sslExpiryDays,
            issuer: cert.issuer ? (cert.issuer.CN || cert.issuer.O || 'Unknown') : 'Unknown',
            subject: cert.subject ? (cert.subject.CN || 'Unknown') : 'Unknown',
            validFrom: validFrom.toISOString(),
            validTo: validTo.toISOString(),
            protocol: socket.getProtocol(),
            authorized: socket.authorized,
            authorizationError: socket.authorizationError ? socket.authorizationError.toString() : null
          };

          socket.destroy();
          resolve(details);
        });

        // Set SSL handshake timeout (3 seconds)
        socket.setTimeout(3000);

        socket.on('timeout', () => {
          logger.warn({ hostname }, 'SSL handshake timed out');
          socket.destroy();
          resolve({
            https: true,
            sslExpiryDays: null,
            error: 'Handshake timeout'
          });
        });

        socket.on('error', (err) => {
          logger.warn({ hostname, error: err.message }, 'SSL connection failed');
          socket.destroy();
          resolve({
            https: true,
            sslExpiryDays: null,
            error: err.message
          });
        });
      });
    } catch (err) {
      logger.error({ err: err.message }, 'Error in SSL service parsing URL');
      return {
        https: false,
        sslExpiryDays: null,
        error: 'Invalid URL supplied to SSL service'
      };
    }
  }
}

module.exports = new SSLService();
