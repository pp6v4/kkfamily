import { constants, readFileSync } from 'node:fs';
import { FileHandle, mkdir, open, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { requireCosMount } from './cos-mount-guard';
import { validateImageBytes } from './image-validation';

const MAX_BYTES = 8 * 1024 * 1024;
const mimeTypes: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export function mountedObjectPath(key: string, checksum: string): { parts: string[]; mimeType: string } {
  if (!/^households\/[a-zA-Z0-9_-]{1,128}\/(recipes|trips|favorites)\/[a-zA-Z0-9_-]{1,128}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key) || !/^[0-9a-f]{64}$/.test(checksum)) {
    throw new Error('Invalid mounted object key');
  }
  const parts = key.split('/');
  const filename = parts.pop()!;
  const extension = filename.slice(filename.lastIndexOf('.') + 1);
  // Content addressing isolates conflicting writes to one upload intent.
  parts.push(`${filename.slice(0, filename.lastIndexOf('.'))}-${checksum}.${extension}`);
  return { parts, mimeType: mimeTypes[extension] };
}

export class MountedObjectStore {
  constructor(private readonly root: string) {}

  assertAvailable(): void {
    if (process.platform !== 'linux') throw new Error('Mounted media requires Linux');
    requireCosMount(readFileSync('/proc/self/mountinfo', 'utf8'), this.root);
  }

  private async withObject<T>(key: string, checksum: string, create: boolean, action: (path: string, mime: string) => Promise<T>): Promise<T> {
    const { parts, mimeType } = mountedObjectPath(key, checksum);
    this.assertAvailable();
    const handles: FileHandle[] = [];
    try {
      const rootHandle = await open(this.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      handles.push(rootHandle);
      // Verify the opened descriptor belongs to the checked mount, closing the
      // check/open race. All traversal is then relative to held descriptors.
      const mountId = requireCosMount(await readFile('/proc/self/mountinfo', 'utf8'), this.root);
      const fdInfo = await readFile(`/proc/self/fdinfo/${rootHandle.fd}`, 'utf8');
      if (fdInfo.match(/^mnt_id:\s*(\d+)$/m)?.[1] !== mountId) throw new Error('Media mount changed');
      let directory = rootHandle;
      for (const component of parts.slice(0, -1)) {
        const child = `/proc/self/fd/${directory.fd}/${component}`;
        if (create) {
          try { await mkdir(child, { mode: 0o700 }); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        }
        directory = await open(child, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        handles.push(directory);
        const info = await readFile(`/proc/self/fdinfo/${directory.fd}`, 'utf8');
        if (info.match(/^mnt_id:\s*(\d+)$/m)?.[1] !== mountId) throw new Error('Unexpected nested mount');
      }
      return await action(`/proc/self/fd/${directory.fd}/${parts.at(-1)!}`, mimeType);
    } finally {
      await Promise.all(handles.reverse().map(handle => handle.close()));
    }
  }

  async put(key: string, body: Buffer, mimeType: string, checksum: string): Promise<void> {
    if (!body.length || body.length > MAX_BYTES || createHash('sha256').update(body).digest('hex') !== checksum) throw new Error('Invalid image checksum or size');
    await this.withObject(key, checksum, true, async (path, expectedMime) => {
      if (mimeType !== expectedMime) throw new Error('Invalid image type');
      validateImageBytes(body, mimeType, body.length);
      const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(body); await file.sync(); }
      finally { await file.close(); }
    });
    // COS FUSE must finish close/upload before acknowledgement. Verify the bytes
    // rather than trusting local write completion or separate metadata sidecars.
    await this.get(key, checksum);
  }

  async get(key: string, checksum: string): Promise<{ body: Buffer; mimeType: string }> {
    return this.withObject(key, checksum, false, async (path, mimeType) => {
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) throw new Error('Invalid stored image size');
        // A fixed cap prevents a concurrently enlarged file exhausting memory.
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        let bytes = 0;
        while (bytes < buffer.length) {
          const result = await file.read(buffer, bytes, buffer.length - bytes, bytes);
          if (!result.bytesRead) break;
          bytes += result.bytesRead;
        }
        const body = buffer.subarray(0, bytes);
        if (bytes > MAX_BYTES || createHash('sha256').update(body).digest('hex') !== checksum) throw new Error('Stored image checksum mismatch');
        validateImageBytes(body, mimeType, stat.size);
        return { body, mimeType };
      } finally { await file.close(); }
    });
  }
}
