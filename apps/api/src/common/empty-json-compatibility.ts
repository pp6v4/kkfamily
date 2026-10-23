import { NestFastifyApplication } from '@nestjs/platform-fastify';

/** Compatibility for the released client's optional recalculation payload. */
export function configureEmptyJsonCompatibility(app: NestFastifyApplication) {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', async request => {
    if (request.method !== 'POST' || request.routeOptions.url !== '/v1/meals/:id/recalculate') return;
    const type = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
    if (type !== 'application/json' || request.headers['transfer-encoding'] !== undefined) return;
    const length = request.headers['content-length'];
    if (length !== undefined && length !== '0') return;
    // No transfer framing means no JSON bytes. This action accepts an omitted payload;
    // let Nest's original guard, controller and service process it normally.
    // Nonempty/malformed JSON and every other route keep the original parser.
    delete request.headers['content-type'];
  });
}
