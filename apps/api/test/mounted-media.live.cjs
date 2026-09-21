// Explicit opt-in: writes only under a fresh verification namespace, no database.
// Test objects are retained; deletion needs an approved manifest.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { MountedObjectStore, mountedObjectPath } = require('./mounted-object-store');
const { readFile, stat, writeFile } = require('node:fs/promises');
const root = process.env.MEDIA_MOUNT_ROOT;
if (process.env.ALLOW_COS_VERIFICATION !== 'yes' || root !== '/mnt/family-life-cos') throw Error('Explicit verification configuration required');
const namespace = `verification-${randomUUID()}`;
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==', 'base64');
const hash = body => createHash('sha256').update(body).digest('hex');
const manifest = { namespace, objects: [], checks: [], passed: false };
const store = new MountedObjectStore(root);
function object(folder = 'recipes') { return `households/${namespace}/${folder}/probe/${randomUUID()}.png`; }
function record(key, checksum) {
  const path = `${root}/${mountedObjectPath(key, checksum).parts.join('/')}`;
  manifest.objects.push({ key, checksum, path }); return path;
}
async function main() {
  store.assertAvailable(); manifest.checks.push('exact-cos-mount');
  for (const folder of ['recipes', 'trips', 'favorites']) {
    const key = object(folder); const checksum = hash(image); const path = record(key, checksum);
    await store.put(key, image, 'image/png', checksum);
    const actual = await store.get(key, checksum);
    assert.equal(actual.mimeType, 'image/png'); assert.deepEqual(actual.body, image);
    assert.deepEqual(await readFile(path), image); assert.equal((await stat(path)).size, image.length);
    manifest.checks.push(`${folder}-exact-bytes`);
  }
  const key = object(); const alternative = Buffer.concat([image, Buffer.from('variant')]);
  record(key, hash(image)); record(key, hash(alternative));
  await Promise.all([store.put(key, image, 'image/png', hash(image)), store.put(key, alternative, 'image/png', hash(alternative))]);
  assert.deepEqual((await store.get(key, hash(image))).body, image);
  assert.deepEqual((await store.get(key, hash(alternative))).body, alternative);
  manifest.checks.push('concurrent-different-content-isolated');
  const partialKey = object(); const partialPath = record(partialKey, hash(image));
  await store.put(partialKey, image, 'image/png', hash(image));
  await writeFile(partialPath, image.subarray(0, 8));
  await assert.rejects(store.get(partialKey, hash(image)), /checksum mismatch/);
  await store.put(partialKey, image, 'image/png', hash(image));
  assert.deepEqual((await store.get(partialKey, hash(image))).body, image);
  manifest.checks.push('partial-content-rejected-and-retry-repaired');
  assert.throws(() => new MountedObjectStore('/tmp').assertAvailable());
  await assert.rejects(new MountedObjectStore('/tmp').put(object(), image, 'image/png', hash(image)));
  manifest.checks.push('ordinary-filesystem-rejected');
  manifest.passed = true;
}
main().catch(error => { manifest.error = { name: error.name, message: error.message, code: error.code }; process.exitCode = 1; })
  .finally(() => console.log(JSON.stringify(manifest, null, 2)));
