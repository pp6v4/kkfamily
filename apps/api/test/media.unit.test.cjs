const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateImageBytes } = require('../dist/media/image-validation');

test('image validation accepts only matching JPEG, PNG and WebP signatures', () => {
  const jpeg=Buffer.from([0xff,0xd8,0xff,0x00]);
  const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const webp=Buffer.from('RIFF0000WEBP','ascii');
  assert.equal(validateImageBytes(jpeg,'image/jpeg',jpeg.length),jpeg);
  assert.equal(validateImageBytes(png,'image/png',png.length),png);
  assert.equal(validateImageBytes(webp,'image/webp',webp.length),webp);
  assert.throws(()=>validateImageBytes(png,'image/jpeg',png.length),/图片内容与声明格式不一致/);
  assert.throws(()=>validateImageBytes(png,'image/png',png.length+1),/实际大小/);
  assert.throws(()=>validateImageBytes(Buffer.alloc(0),'image/png',0),/不能为空/);
});
