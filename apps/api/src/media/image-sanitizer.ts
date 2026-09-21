import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
const sharp = require('sharp') as typeof import('sharp').default;
import { validateImageBytes } from './image-validation';

let active = 0;
const formats = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' } as const;

/** Decode pixels then re-encode without metadata. Never fall back to original
 * bytes on failure: EXIF/XMP and embedded thumbnails may contain private data. */
export async function sanitizeImage(body: unknown, mime: string, declaredBytes: number): Promise<Buffer> {
  const input = validateImageBytes(body, mime, declaredBytes);
  if (input.length > 8 * 1024 * 1024) throw new BadRequestException('图片不能超过8MB');
  if (active >= 2) throw new ServiceUnavailableException('图片处理中，请稍后重试');
  active++;
  try {
    const format = formats[mime as keyof typeof formats];
    const pipeline = sharp(input, { limitInputPixels: 50_000_000, failOn: 'warning' });
    const metadata = await pipeline.metadata();
    if (!format || metadata.format !== format || (metadata.pages ?? 1) !== 1) throw new Error('Unsupported image');
    // Apply orientation before removing EXIF so portrait photos stay upright.
    const output = await pipeline.rotate().toFormat(format).timeout({ seconds: 10 }).toBuffer();
    if (!output.length || output.length > 8 * 1024 * 1024) throw new Error('Output too large');
    return output;
  } catch {
    throw new BadRequestException('图片无法安全处理，请换用8MB以内的静态JPG、PNG或WebP图片');
  } finally { active--; }
}
