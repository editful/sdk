import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

interface ArchiveEntry {
  readonly name: string;
  readonly bytes: Buffer;
  readonly compressed: Buffer;
  readonly crc: number;
  readonly offset: number;
}

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_HEADER_BYTES = 22;
const UTF8_FLAG = 0x0800;
const DEFLATE = 8;
const DOS_DATE_1980_01_01 = 33;

export async function createPluginArchive(
  artifactDirectory: string,
  destination: string,
): Promise<{ readonly path: string; readonly byteLength: number }> {
  const files = await collectFiles(artifactDirectory);
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  for (const file of files) {
    const bytes = await readFile(join(artifactDirectory, file));
    const compressed = deflateRawSync(bytes, { level: 9 });
    const nameBytes = Buffer.from(file);
    entries.push({
      name: file,
      bytes,
      compressed,
      crc: crc32(bytes),
      offset,
    });
    offset += LOCAL_HEADER_BYTES + nameBytes.byteLength + compressed.byteLength;
  }

  const local = entries.map(localEntry);
  const central = entries.map(centralEntry);
  const centralSize = central.reduce((total, entry) => total + entry.byteLength, 0);
  const end = Buffer.alloc(END_HEADER_BYTES);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...local, ...central, end]);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, archive);
  return Object.freeze({ path: destination, byteLength: archive.byteLength });
}

async function collectFiles(root: string): Promise<readonly string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        result.push(relative(root, path).split(sep).join('/'));
      } else {
        throw new TypeError(`Plugin archives cannot contain symlinks or special files: ${path}`);
      }
    }
  };
  if (!(await stat(root)).isDirectory()) {
    throw new TypeError(`Plugin artifact is not a directory: ${root}`);
  }
  await visit(root);
  return Object.freeze(result.sort());
}

function localEntry(entry: ArchiveEntry): Buffer {
  const name = Buffer.from(entry.name);
  const header = Buffer.alloc(LOCAL_HEADER_BYTES);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(DEFLATE, 8);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressed.byteLength, 18);
  header.writeUInt32LE(entry.bytes.byteLength, 22);
  header.writeUInt16LE(name.byteLength, 26);
  return Buffer.concat([header, name, entry.compressed]);
}

function centralEntry(entry: ArchiveEntry): Buffer {
  const name = Buffer.from(entry.name);
  const header = Buffer.alloc(CENTRAL_HEADER_BYTES);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(DEFLATE, 10);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressed.byteLength, 20);
  header.writeUInt32LE(entry.bytes.byteLength, 24);
  header.writeUInt16LE(name.byteLength, 28);
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, name]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
