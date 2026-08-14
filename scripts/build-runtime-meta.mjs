import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = path.join(ROOT, 'data', 'search-index.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'runtime-meta.json');

if (!fs.existsSync(INDEX_PATH)) {
  throw new Error('data/search-index.json is required before building runtime metadata');
}

const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
const output = {
  version: 1,
  builtAt: index.builtAt || null,
  snapshotDate: index.snapshotDate || null,
  election: index.election || null,
  counts: index.counts || {},
  indexVersion: index.version || null
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Runtime metadata built: ${output.counts?.proposals ?? 0} proposals, index v${output.indexVersion ?? 'unknown'}.`);
