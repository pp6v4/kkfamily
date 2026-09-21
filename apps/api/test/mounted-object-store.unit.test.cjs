require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mountedObjectPath, MountedObjectStore } = require('../dist/media/mounted-object-store');
const { ObjectStorageService } = require('../dist/media/object-storage.service');
const key = 'households/house-a/recipes/recipe-a/12345678-1234-1234-1234-123456789012.png';
const checksum = 'a'.repeat(64);

test('physical image path is content-addressed, preserving image extension and resource isolation', () => {
  const result = mountedObjectPath(key, checksum);
  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual(result.parts, ['households', 'house-a', 'recipes', 'recipe-a', `12345678-1234-1234-1234-123456789012-${checksum}.png`]);
  assert.notDeepEqual(result, mountedObjectPath(key, 'b'.repeat(64)));
  for (const folder of ['trips', 'favorites']) assert.equal(mountedObjectPath(key.replace('recipes', folder), checksum).parts[2], folder);
  for (const ext of ['jpg', 'webp']) assert.equal(mountedObjectPath(key.replace('.png', `.${ext}`), checksum).mimeType, ext === 'jpg' ? 'image/jpeg' : 'image/webp');
});

test('reject path traversal, ambiguous encoding, unsupported resources and malformed checksums', () => {
  for (const invalid of [key.replace('house-a', '..'), `/${key}`, key.replace('recipe-a', '%2e%2e'), key.replace('recipes', 'archives'), key.replace('.png', '.svg'), key.replace('house-a', 'house\\a'), `${key}\0`, `${key}/extra`]) {
    assert.throws(() => mountedObjectPath(invalid, checksum));
  }
  for (const invalid of ['', '../escape', 'A'.repeat(64), 'a'.repeat(63)]) assert.throws(() => mountedObjectPath(key, invalid));
});

test('missing mount fails closed, never creating ordinary directories', async () => {
  const root = '/does-not-exist-family-life-mount-test';
  const store = new MountedObjectStore(root);
  assert.throws(() => store.assertAvailable());
  const body = Buffer.from([137,80,78,71,13,10,26,10]);
  const digest = createHash('sha256').update(body).digest('hex');
  await assert.rejects(store.put(key, body, 'image/png', digest));
  await assert.rejects(store.get(key, digest));
  assert.equal(require('node:fs').existsSync(root), false);
});

test('public storage facade returns 503 for unavailable mount; disabled and memory behavior retained', async () => {
  const config = values => ({ get: name => values[name], getOrThrow: name => { if (!values[name]) throw Error('missing'); return values[name]; } });
  const service = new ObjectStorageService(config({ MEDIA_DRIVER: 'mounted', MEDIA_MOUNT_ROOT: '/does-not-exist-family-life-mount-test' }));
  assert.throws(() => service.assertAvailable(), error => error.getStatus() === 503);
  await assert.rejects(service.get(key, checksum), error => error.getStatus() === 503);
  assert.throws(() => new ObjectStorageService(config({ MEDIA_DRIVER: 'unknown' })));
  assert.throws(() => new ObjectStorageService(config({ MEDIA_DRIVER: 'memory', NODE_ENV: 'production' })));
  const memory = new ObjectStorageService(config({ MEDIA_DRIVER: 'memory', NODE_ENV: 'test' }));
  await memory.put('key', Buffer.from('hello'), 'image/png', checksum);
  assert.deepEqual(await memory.head('key', checksum), { bytes: 5, mimeType: 'image/png', checksumSha256: checksum });
  assert.equal((await memory.get('key', checksum)).body.toString(), 'hello');
});
