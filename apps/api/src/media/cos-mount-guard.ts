import { posix } from 'node:path';

function decodeMountField(value: string): string {
  return value.replace(/\\(040|011|012|134)/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

/** Linux mountinfo, including Docker bind mounts: require the exact directory,
 * not merely a FUSE ancestor. A normal directory must never be a fallback. */
export function requireCosMount(mountInfo: string, root: string): string {
  if (!root.startsWith('/') || root === '/' || posix.normalize(root) !== root || root.includes('\0')) {
    throw new Error('Invalid media mount root');
  }
  const matches = mountInfo.split('\n').filter(line => {
    const fields = line.split(' ');
    return fields.length >= 10 && decodeMountField(fields[4]) === root;
  });
  // Reject stacked/ambiguous mounts rather than accidentally accepting a hidden one.
  if (matches.length !== 1) throw new Error('COS mount missing or ambiguous');
  const fields = matches[0].split(' ');
  const separator = fields.indexOf('-');
  if (separator < 6 || fields[separator + 1] !== 'fuse.cosfs' ||
      !fields[5].split(',').includes('rw') || !fields[separator + 3]?.split(',').includes('rw')) {
    throw new Error('Expected writable COS filesystem');
  }
  return fields[0];
}
