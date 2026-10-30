// Fails the build if dist/index.html references a local stylesheet/script that is not in dist.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const dist = join(process.cwd(), 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const refs = [...html.matchAll(/<(?:link|script)\b[^>]*?\b(?:href|src)=["']([^"']+)["'][^>]*>/gi)]
  .map((m) => m[1])
  .filter((u) => !/^(?:[a-z]+:)?\/\//i.test(u) && !u.startsWith('data:'));
const missing = refs.filter((u) => !existsSync(join(dist, u.split(/[?#]/)[0].replace(/^\//, ''))));
if (missing.length) {
  console.error(`dist/index.html references missing local assets: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`check-dist-assets: ${refs.length} local asset reference(s) OK`);
