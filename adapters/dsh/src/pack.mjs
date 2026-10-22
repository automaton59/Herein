import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fail } from './common.mjs';

// A deterministic ustar archive of reviewed files. Packaging executes no code
// and does not install anything; DSH owns unpacking and package management.
export async function packReviewedDirectory(root, output) {
  const blocks = [];
  function field(buffer, offset, length, value) { buffer.write(value, offset, length, 'ascii'); }
  async function walk(dir, prefix = 'package/') {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name), stat = await lstat(path), archiveName = prefix + name;
      if (stat.isSymbolicLink()) throw fail('ARTIFACT_SYMLINK');
      if (stat.isDirectory()) { await walk(path, archiveName + '/'); continue; }
      if (!stat.isFile()) throw fail('ARTIFACT_SPECIAL_FILE');
      let base = archiveName, pathPrefix = '';
      if (Buffer.byteLength(base) > 100) {
        const split = archiveName.lastIndexOf('/');
        base = archiveName.slice(split + 1); pathPrefix = archiveName.slice(0, split);
        if (Buffer.byteLength(base) > 100 || Buffer.byteLength(pathPrefix) > 155) throw fail('ARTIFACT_PATH_TOO_LONG');
      }
      const data = await readFile(path), header = Buffer.alloc(512);
      header.write(base, 0, 100, 'utf8'); header.write(pathPrefix, 345, 155, 'utf8');
      field(header, 100, 8, '0000644\0'); field(header, 108, 8, '0000000\0'); field(header, 116, 8, '0000000\0');
      field(header, 124, 12, data.length.toString(8).padStart(11, '0') + '\0');
      field(header, 136, 12, '00000000000\0'); header.fill(32, 148, 156); header[156] = 48;
      field(header, 257, 6, 'ustar\0'); field(header, 263, 2, '00');
      const sum = header.reduce((total, byte) => total + byte, 0);
      field(header, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
      blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
    }
  }
  await walk(root); blocks.push(Buffer.alloc(1024));
  await writeFile(output, gzipSync(Buffer.concat(blocks), { level: 9 }), { mode: 0o600 });
}
