require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { sanitizeImage } = require('../dist/media/image-sanitizer');

for (const [format, mime] of [['jpeg','image/jpeg'], ['png','image/png'], ['webp','image/webp']]) {
  test(`${format}: metadata stripped, pixels decodable, orientation applied and retries deterministic`, async () => {
    const input = await sharp({ create: { width: 7, height: 3, channels: 3, background: '#88aa44' } })
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Artist: 'private-artist' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '31/1 12/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '121/1 30/1 0/1' } })
      .toFormat(format).toBuffer();
    const before = await sharp(input).metadata();
    assert.ok(before.exif?.length, 'fixture must really contain EXIF');
    assert.equal(before.orientation, 6);
    const output = await sanitizeImage(input, mime, input.length);
    const after = await sharp(output).metadata();
    assert.equal(after.format, format); assert.equal(after.width, 3); assert.equal(after.height, 7);
    for (const name of ['exif','xmp','iptc','icc','orientation']) assert.equal(after[name], undefined, `${name} must be removed`);
    assert.equal(output.includes(Buffer.from('private-artist')), false);
    assert.equal((await sharp(output).raw().toBuffer()).length, 3 * 7 * 3);
    assert.deepEqual(await sanitizeImage(input, mime, input.length), output);
    assert.notDeepEqual(output, input);
  });
}

test('invalid/truncated photos and declared byte mismatch never fall back to original bytes', async () => {
  const invalid = Buffer.from([255,216,255,225,0,5,1,2,3]);
  await assert.rejects(sanitizeImage(invalid, 'image/jpeg', invalid.length), error => error.getStatus() === 400);
  await assert.rejects(sanitizeImage(invalid, 'image/jpeg', invalid.length + 1), error => error.getStatus() === 400);
});
