import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = path.join(ROOT, 'data', 'search-index.json');

function parseFrontmatterValue(source, key) {
  if (!source.startsWith('---\n')) return null;
  const end = source.indexOf('\n---\n', 4);
  if (end === -1) return null;
  const raw = source.slice(4, end);
  const line = raw.split(/\r?\n/).find((item) => item.startsWith(`${key}:`));
  if (!line) return null;
  let value = line.slice(line.indexOf(':') + 1).trim();
  if (!value || value === 'null' || value === '~') return null;
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1);
  return value || null;
}

function metadataForPath(relativePath) {
  if (!relativePath || relativePath === 'data/entities.json') return {};
  const full = path.join(ROOT, ...relativePath.split('/'));
  if (!fs.existsSync(full) || !full.endsWith('.md')) return {};
  const source = fs.readFileSync(full, 'utf8');
  return {
    dateBasis: parseFrontmatterValue(source, 'date_basis'),
    capturedAt: parseFrontmatterValue(source, 'captured_at')
  };
}

if (!fs.existsSync(INDEX_PATH)) throw new Error('search-index.json absent; exécuter build-search-index.mjs avant cet enrichissement');
const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
const cache = new Map();
for (const chunk of index.chunks || []) {
  if (!cache.has(chunk.path)) cache.set(chunk.path, metadataForPath(chunk.path));
  const metadata = cache.get(chunk.path) || {};
  if (metadata.dateBasis) chunk.dateBasis = metadata.dateBasis;
  if (metadata.capturedAt) chunk.capturedAt = metadata.capturedAt;
}
index.version = Math.max(Number(index.version || 0), 4);
fs.writeFileSync(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log(`Search index temporal metadata enriched for ${cache.size} record path(s).`);
