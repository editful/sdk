import { chmod } from 'node:fs/promises';

const file = process.argv[2];
if (file === undefined) throw new TypeError('Expected a file path');

await chmod(file, 0o755);
