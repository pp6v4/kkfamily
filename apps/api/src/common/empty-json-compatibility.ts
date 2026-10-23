import { NestFastifyApplication } from '@nestjs/platform-fastify';

const optionalBodyRoutes: Record<string, readonly string[]> = {
  POST: ['/v1/meals/:id/recalculate'],
  DELETE: [
    '/v1/meals/:id/items/:recipeId',
    '/v1/trips/:tripId/stops/:stopId',
    '/v1/trips/:tripId/legs/:legId',
    '/v1/trips/:tripId/accommodations/:accommodationId',
    '/v1/trips/:tripId/packing-items/:itemId',
  ],
};

/** Compatibility only for released bodyless actions, never body-required writes. */
export function configureEmptyJsonCompatibility(app: NestFastifyApplication) {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', async request => {
    const route = request.routeOptions.url;
    if (!route || !optionalBodyRoutes[request.method]?.includes(route)) return;
    const type = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
    if (type !== 'application/json' || request.headers['transfer-encoding'] !== undefined) return;
    const length = request.headers['content-length'];
    if (length !== undefined && length !== '0') return;
    // No transfer framing means no JSON bytes. These actions accept omitted payloads;
    // let Nest's original guard, controller and service process it normally.
    // Nonempty/malformed JSON and every other route keep the original parser.
    delete request.headers['content-type'];
  });
}
