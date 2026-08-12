import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = path.join(ROOT, 'data', 'search-index.json');

function parseMeta(filePath) {
  if (!filePath || filePath === 'data/entities.json') return {};
  const full = path.join(ROOT, filePath);
  if (!fs.existsSync(full) || !full.endsWith('.md')) return {};
  const source = fs.readFileSync(full, 'utf8');
  if (!source.startsWith('---\n')) return {};
  const end = source.indexOf('\n---\n', 4);
  if (end < 0) return {};
  const meta = {};
  for (const line of source.slice(4, end).split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 1 || line.startsWith(' ')) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1);
    meta[key] = value;
  }
  return meta;
}

function ids(value) {
  if (!value) return [];
  let text = String(value).trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  return text.split(',').map((part) => part.trim().split("'").join('').split('"').join('')).filter(Boolean);
}

const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
const byPath = new Map();
for (const chunk of index.chunks || []) {
  if (!byPath.has(chunk.path)) byPath.set(chunk.path, parseMeta(chunk.path));
}

const documents = new Map();
for (const meta of byPath.values()) {
  if (meta.document_id) documents.set(meta.document_id, meta);
}

for (const chunk of index.chunks || []) {
  const meta = byPath.get(chunk.path) || {};
  let basis = meta.date_basis || null;
  let capturedAt = meta.captured_at || null;
  if (!basis) {
    const sourceIds = ids(meta.source_document_ids || meta.source_document_id);
    const linked = sourceIds.map((id) => documents.get(id)).filter(Boolean);
    const bases = [...new Set(linked.map((item) => item.date_basis).filter(Boolean))];
    if (bases.length === 1) {
      basis = bases[0];
      capturedAt = linked.map((item) => item.captured_at).filter(Boolean).sort()[0] || null;
    }
  }
  if (basis) chunk.dateBasis = basis;
  if (capturedAt) chunk.capturedAt = capturedAt;
}
index.version = Math.max(Number(index.version || 0), 4);
fs.writeFileSync(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log('Search index date provenance propagated.');
