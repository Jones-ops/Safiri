const { version } = require('../../package.json');

/** Liveness for the host and uptime checks. No secrets, no database call. */
async function healthRoutes(app) {
  app.get('/health', async () => ({ ok: true, service: 'safiri-api', version, time: new Date().toISOString() }));
}

module.exports = healthRoutes;
