import { lstat, readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ignored = new Set(['.git', 'dist', 'node_modules', 'coverage']);
const textExtensions = new Set([
  '',
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.svg',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const forbidden = [
  ['private package import', /@ic\//u],
  ['private application path', /(?:^|[/'"])(?:apps\/desktop|server\/crates|packages\/(?:host|renderer|scene))(?:[/'"]|$)/mu],
  ['private source repository name', /infinite-canvas/iu],
  ['private service endpoint', /assets-canvas\.sam\.ink/iu],
  ['private credential name', /UNSPLASH_ACCESS_KEY/u],
  ['local application checkout', /samschooler\/(?:conductor|repo)\/ideas/iu],
];

const files = await collect(root);
for (const path of files) {
  if (relative(root, path) === 'scripts/verify-public-boundary.mjs') continue;
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Public repository must not contain symlinks: ${relative(root, path)}`);
  }
  if (!metadata.isFile() || !textExtensions.has(extname(path))) continue;
  const source = await readFile(path, 'utf8');
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) {
      throw new Error(`${label} found in ${relative(root, path)}`);
    }
  }
  if (path.endsWith('package.json')) {
    const manifest = JSON.parse(source);
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const name of Object.keys(manifest[section] ?? {})) {
        if (name.startsWith('@ic/')) {
          throw new Error(`Private dependency ${name} found in ${relative(root, path)}`);
        }
      }
    }
  }
}

console.log(`Verified public boundary across ${files.length} files`);

async function collect(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    result.push(path);
    if (entry.isDirectory()) result.push(...await collect(path));
  }
  return result;
}
