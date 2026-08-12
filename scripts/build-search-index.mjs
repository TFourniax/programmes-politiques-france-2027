import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTITIES_PATH = path.join(ROOT, 'data', 'entities.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'search-index.json');

const entities = JSON.parse(fs.readFileSync(ENTITIES_PATH, 'utf8'));
const candidateById = new Map(entities.candidates.map((item) => [item.id, item]));
const partyById = new Map(entities.parties.map((item) => [item.id, item]));

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function parseScalar(raw) {
  const value = raw.trim();
  if (!value || value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => parseScalar(item))
      .filter((item) => item !== null && item !== '');
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function parseFrontmatter(source) {
  if (!source.startsWith('---\n')) return { meta: {}, body: source };
  const end = source.indexOf('\n---\n', 4);
  if (end === -1) return { meta: {}, body: source };
  const raw = source.slice(4, end);
  const meta = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || /^\s/.test(line)) continue;
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    meta[key] = parseScalar(value);
  }
  return { meta, body: source.slice(end + 5).trim() };
}

function cleanMarkdown(value = '') {
  return String(value)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sectionedParagraphs(body) {
  const lines = body.split(/\r?\n/);
  let section = null;
  let buffer = [];
  const blocks = [];

  const flush = () => {
    const text = cleanMarkdown(buffer.join('\n'));
    if (text) blocks.push({ section, text });
    buffer = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (match) {
      flush();
      section = cleanMarkdown(match[2]);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return blocks;
}

function sentenceAlignedTail(text, overlap) {
  const clean = text.trim();
  if (!clean || clean.length <= overlap) return clean;
  const window = clean.slice(-overlap);
  const boundary = /[.!?…](?:["»”')\]]*)?\s+/.exec(window);
  if (!boundary) return '';
  return window.slice(boundary.index + boundary[0].length).trim();
}

function chunkBlocks(blocks, target = 1100, overlap = 180) {
  const chunks = [];
  let current = '';
  let section = null;

  const emit = () => {
    const text = current.trim();
    if (!text) return;
    chunks.push({ section, text });
    current = sentenceAlignedTail(text, overlap);
  };

  for (const block of blocks) {
    const prefix = block.section ? `${block.section}. ` : '';
    const addition = `${prefix}${block.text}`.trim();
    if (!addition) continue;
    if (current && current.length + addition.length + 1 > target) emit();
    if (!current.trim()) section = block.section || section;
    current = `${current}${current ? ' ' : ''}${addition}`;
    section = block.section || section;
  }
  if (current.trim()) chunks.push({ section, text: current.trim() });
  return chunks.filter((item, index, array) => index === 0 || item.text !== array[index - 1].text);
}

function entityLabel(id) {
  return candidateById.get(id)?.name || partyById.get(id)?.name || id || 'Entité inconnue';
}

function candidateStatus(id) {
  return candidateById.get(id)?.current_status || null;
}

function candidateConfidence(id) {
  return candidateById.get(id)?.status_confidence || null;
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function listValue(value) {
  if (value === null || value === undefined || value === '') return [];
  return (Array.isArray(value) ? value : [value]).map((item) => String(item)).filter(Boolean);
}

const chunks = [];

for (const candidate of entities.candidates) {
  chunks.push({
    id: `candidate:${candidate.id}`,
    recordId: candidate.id,
    kind: 'candidate_status',
    entityId: candidate.id,
    entityLabel: candidate.name,
    title: `Statut de ${candidate.name}`,
    text: `${candidate.name}. Statut au ${entities.snapshot_date}: ${candidate.current_status}. Niveau de confiance de la preuve: ${candidate.status_confidence}. ${candidate.declared_at ? `Date de déclaration enregistrée: ${candidate.declared_at}.` : ''} ${candidate.primary_party_id ? `Parti ou mouvement principal enregistré: ${candidate.primary_party_id}.` : ''} Aucun statut official_candidate n'est utilisé avant la liste du Conseil constitutionnel.`,
    path: 'data/entities.json',
    sourceUrl: candidate.source_url || null,
    sourceTier: candidate.source_tier || null,
    documentStatus: 'current',
    proposalStatus: null,
    supersedes: [],
    supersededBy: [],
    sourceDocumentIds: [],
    candidateStatus: candidate.current_status,
    publishedAt: candidate.declared_at || candidate.status_as_of || entities.snapshot_date,
    confidence: candidate.status_confidence,
    certainty: null,
    topics: ['candidat', 'candidature', 'statut', candidate.current_status, candidate.primary_party_id].filter(Boolean),
    section: 'Statut',
    chunkIndex: 0
  });
}

for (const party of entities.parties) {
  chunks.push({
    id: `party:${party.id}`,
    recordId: party.id,
    kind: 'party_profile',
    entityId: party.id,
    entityLabel: party.name,
    title: `Parti : ${party.name}`,
    text: `${party.name} est un parti ou mouvement suivi dans le corpus. Une plateforme de parti n'est jamais attribuée automatiquement à un candidat.`,
    path: 'data/entities.json',
    sourceUrl: party.official_website || null,
    sourceTier: party.official_website ? 'tier_1_primary_official' : null,
    documentStatus: 'current',
    proposalStatus: null,
    supersedes: [],
    supersededBy: [],
    sourceDocumentIds: [],
    candidateStatus: null,
    publishedAt: entities.snapshot_date,
    confidence: party.official_website ? 'high' : 'medium',
    certainty: null,
    topics: ['parti', 'mouvement', 'programme'],
    section: 'Profil',
    chunkIndex: 0
  });
}

const documentFiles = walk(path.join(ROOT, 'corpus', '2027')).filter((file) => file.endsWith('.md')).sort();
const proposalFiles = walk(path.join(ROOT, 'proposals')).filter((file) => file.endsWith('.md')).sort();
const markdownFiles = [...documentFiles, ...proposalFiles].sort();

for (const file of markdownFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const { meta, body } = parseFrontmatter(source);
  const filePath = relative(file);
  const isProposal = filePath.startsWith('proposals/');
  const entityId = meta.entity_id || null;
  const recordId = isProposal ? (meta.proposal_id || filePath) : (meta.document_id || filePath);
  const title = meta.title || cleanMarkdown(body.match(/^#\s+(.+)$/m)?.[1] || path.basename(file, '.md'));
  const sourceUrl = meta.source_url || meta.primary_source_url || null;
  const proposalStatus = isProposal ? (meta.proposal_status || null) : null;
  // A proposal's own lifecycle is authoritative for current-vs-history filtering.
  // document_status is still retained as a fallback for legacy proposal files that do not yet expose proposal_status.
  const documentStatus = isProposal
    ? (proposalStatus || meta.document_status || 'current')
    : (meta.document_status || 'unknown');
  const topics = [meta.topic, meta.subtopic, meta.document_type, documentStatus].flat().filter(Boolean);
  const blocks = sectionedParagraphs(body);
  const bodyChunks = chunkBlocks(blocks);

  bodyChunks.forEach((item, index) => {
    chunks.push({
      id: `${recordId}#${index + 1}`,
      recordId,
      kind: isProposal ? 'proposal' : 'document',
      entityId,
      entityLabel: entityLabel(entityId),
      title,
      text: item.text,
      path: filePath,
      sourceUrl,
      sourceTier: meta.source_tier || null,
      documentStatus,
      proposalStatus,
      supersedes: listValue(meta.supersedes),
      supersededBy: listValue(meta.superseded_by),
      sourceDocumentIds: listValue(meta.source_document_ids || meta.source_document_id),
      candidateStatus: candidateStatus(entityId),
      publishedAt: meta.published_at || meta.first_documented_at || null,
      confidence: meta.verification_state === 'verified' ? 'high' : candidateConfidence(entityId),
      certainty: meta.certainty || null,
      topics,
      section: item.section || null,
      chunkIndex: index
    });
  });
}

const counts = {
  candidates: entities.candidates.length,
  parties: entities.parties.length,
  documents: documentFiles.length,
  proposals: proposalFiles.length,
  markdownFiles: markdownFiles.length,
  chunks: chunks.length,
  documentChunks: chunks.filter((item) => item.kind === 'document').length,
  proposalChunks: chunks.filter((item) => item.kind === 'proposal').length,
  historicalPolicyRecords: new Set(chunks.filter((item) => ['document', 'proposal'].includes(item.kind) && ['superseded', 'withdrawn', 'archived', 'rejected', 'draft'].includes(String(item.documentStatus || '').toLowerCase())).map((item) => item.path)).size
};

const output = {
  version: 3,
  builtAt: new Date().toISOString(),
  snapshotDate: entities.snapshot_date,
  election: entities.election,
  counts,
  chunks
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Search index built: ${counts.chunks} chunks from ${counts.documents} documents and ${counts.proposals} proposals.`);