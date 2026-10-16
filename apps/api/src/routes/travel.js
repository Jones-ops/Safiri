/**
 * Travel day:
 *   GET /v1/bookings/:id/itinerary   days, times, contacts, map area, emergency numbers
 * Owner or booking token (guests). Only for confirmed trips.
 */
const { ItineraryError } = require('../services/itinerary');

async function travelRoutes(app, { itinerary, mayAccess, optionalUser }) {
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ItineraryError) return reply.code(err.status).send({ error: err.code });
    request.log.error({ err }, 'travel route failed');
    return reply.code(500).send({ error: 'server_error' });
  });

  app.get('/v1/bookings/:id/itinerary', { preHandler: optionalUser }, async (request, reply) => {
    if (!(await mayAccess(request, request.params.id, request.query.token))) return reply.code(404).send({ error: 'not_found' });
    return itinerary.forBooking(request.params.id);
  });
}

module.exports = travelRoutes;
