import { NestFastifyApplication } from '@nestjs/platform-fastify';

/** Register before Nest initializes routes. Both URLs share the same Nest handler. */
export function configurePatchCompatibility(app: NestFastifyApplication) {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRoute', function (route) {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!methods.includes('PATCH')) return;
    // POST aliases cannot re-enter the PATCH branch. Never honor method-override headers.
    this.route({
      ...route,
      method: 'POST',
      url: `${route.routePath.replace(/\/$/, '')}/_patch`,
    });
  });
}
