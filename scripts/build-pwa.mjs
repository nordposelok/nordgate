import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const lists = await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]));
  return lists.flat();
}
const files = (await walk(dist)).filter((path) => !['sw.js', '.nojekyll'].includes(relative(dist, path))).sort();
const hash = createHash('sha256');
for (const path of files) {
  hash.update(relative(dist, path).split(sep).join('/'));
  hash.update(await readFile(path));
}
const template = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');
// A worker-only change must get a distinct cache too. Otherwise a failed
// reinstall could delete the cache still used by the previous active worker.
hash.update(template);
const release = hash.digest('hex').slice(0, 16);
const assets = files.map((path) => `./${relative(dist, path).split(sep).join('/')}`);
const header = `const CACHE_PREFIX = 'nordgate:' + self.registration.scope + ':';\nconst CACHE_NAME = CACHE_PREFIX + ${JSON.stringify(release)};\nconst ASSETS = ${JSON.stringify(assets)};\n`;
await writeFile(join(dist, 'sw.js'), header + template);
await writeFile(join(dist, '.nojekyll'), '');
console.log(`PWA release ${release}: ${assets.length} files precached.`);
