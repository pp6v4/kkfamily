const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requireCosMount } = require('../dist/media/cos-mount-guard');
const root = '/mnt/family-life-cos';
const line = '41 30 0:44 / /mnt/family-life-cos rw,nosuid,nodev shared:10 - fuse.cosfs cosfs rw,user_id=0';

test('accept exact writable cosfs mount, including Docker bind mount root', () => {
  assert.doesNotThrow(() => requireCosMount(line, root));
  assert.doesNotThrow(() => requireCosMount(line.replace('0:44 / ', '0:44 /family-life '), root));
});

test('reject missing, parent-only, normal-disk, read-only, other-FUSE and stacked mounts', () => {
  for (const input of ['', line.replace(root, '/mnt'), line.replace('fuse.cosfs', 'ext4'),
    line.replace('fuse.cosfs', 'fuse.sshfs'), line.replace(' rw,nosuid', ' ro,nosuid'),
    line.replace(' rw,user_id', ' ro,user_id'), `${line}\n${line.replace('fuse.cosfs', 'ext4')}`]) {
    assert.throws(() => requireCosMount(input, root));
  }
});

test('decode Linux escaped paths and reject unsafe root configuration', () => {
  assert.doesNotThrow(() => requireCosMount(line.replace(root, '/mnt/family\\040life'), '/mnt/family life'));
  for (const path of ['/', 'relative', '/mnt/../mnt/family-life-cos', `${root}/`, `${root}\0`]) {
    assert.throws(() => requireCosMount(line, path));
  }
});
