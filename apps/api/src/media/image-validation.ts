import { BadRequestException } from '@nestjs/common';

export function validateImageBytes(body: unknown, expectedMime: string, declaredBytes: number): Buffer {
  if (!Buffer.isBuffer(body) || !body.length) throw new BadRequestException('图片内容不能为空');
  if (body.length !== declaredBytes) throw new BadRequestException('图片实际大小与上传申请不一致');
  const valid = expectedMime === 'image/jpeg' ? body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
    : expectedMime === 'image/png' ? body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))
    : expectedMime === 'image/webp' ? body.length >= 12 && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP'
    : false;
  if (!valid) throw new BadRequestException('图片内容与声明格式不一致');
  return body;
}
