import { openSync, readSync, closeSync } from 'node:fs';

// Read selected shipped documentation without extracting or executing it.
export function readAsar(archive, name) {
  const fd = openSync(archive, 'r');
  try {
    const prefix = Buffer.alloc(16);
    readSync(fd, prefix, 0, 16, 0);
    const header = Buffer.alloc(prefix.readUInt32LE(12));
    readSync(fd, header, 0, header.length, 16);
    let entry = JSON.parse(header.toString('utf8'));
    for (const part of name.split('/')) entry = entry.files?.[part];
    if (!entry || entry.files || entry.unpacked) throw new Error(`Not a packed file: ${name}`);
    const body = Buffer.alloc(entry.size);
    readSync(fd, body, 0, body.length, 8 + prefix.readUInt32LE(4) + Number(entry.offset));
    return body.toString('utf8');
  } finally { closeSync(fd); }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  const [archive, name, start = '1', end = '999999'] = process.argv.slice(2);
  const lines = readAsar(archive, name).split('\n');
  process.stdout.write(lines.slice(Number(start) - 1, Number(end)).map((line, i) => `${Number(start) + i}: ${line}`).join('\n') + '\n');
}
