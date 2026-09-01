import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { MAX_IMAGE_BYTES, SUPPORTED_IMAGE_TYPES } from './dto/create-upload-intent.dto';

export function configureImageBodyParser(app: NestFastifyApplication) {
  const fastify = app.getHttpAdapter().getInstance();
  for (const mimeType of SUPPORTED_IMAGE_TYPES) {
    if (fastify.hasContentTypeParser(mimeType)) continue;
    fastify.addContentTypeParser(mimeType, { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES }, (_request, body, done) => done(null, body));
  }
}
