import { readFile } from 'node:fs/promises';
import { deepStrictEqual } from 'node:assert';
import { parseGates } from '../src/domain.ts';

const source = process.argv[2];
if (!source) {
  console.error('Usage: npm run check:android -- "E:/#prjw/tsn/nordgate/Resources/Raw/phones.json"');
  process.exitCode = 1;
} else {
  const android = parseGates(JSON.parse(await readFile(source, 'utf8')));
  const web = parseGates(JSON.parse(await readFile(new URL('../public/phones.json', import.meta.url), 'utf8')));
  deepStrictEqual(web, android, 'Web gate data differs from Android. Review and update public/phones.json.');
  console.log(`Web and Android gate data match (${web.length} entries).`);
}
