import { readFile } from 'node:fs/promises';
import { parseGates } from '../src/domain.ts';

const gates = parseGates(JSON.parse(await readFile(new URL('../public/phones.json', import.meta.url), 'utf8')));
console.log(`Gate data valid: ${gates.length} entries.`);
