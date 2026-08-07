import corpus from "../data/corpus.json";

const REPO = process.env.NEXT_PUBLIC_REPOSITORY_URL || "https://github.com/TFourniax/programmes-politiques-france-2027";
const STOP = new Set(["a","au","aux","avec","ce","ces","dans","de","des","du","elle","en","et","eux","il","je","la","le","les","leur","lui","ma","mais","me","meme","mes","moi","mon","ne","nos","notre","nous","on","ou","par","pas","pour","qu","que","qui","sa","se","ses","son","sur","ta","te","tes","toi","ton","tu","un","une","vos","votre","vous"]);

function norm(value="") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function tokens(value) { return [...new Set(norm(value).split(/\s+/).filter(x => x.length > 1 && !STOP.has(x)))]; }
function labelFor(id) { return corpus.candidates.find(x=>x.id===id)?.name || corpus.parties.find(x=>x.id===id)?.name || id; }
function candidateStatus(id) { return corpus.candidates.find(x=>x.id===id)?.status || null; }

const chunks = [
  ...corpus.candidates.map(c => ({
    id:`candidate:${c.id}`, kind:"candidate_status", entityId:c.id, entityLabel:c.name,
    title:`Statut de ${c.name}`, text:`${c.name}. Statut dans l'instantané du ${corpus.snapshot_date}: ${c.status}. Vérification: ${c.verification}. ${c.declared_at ? `Date de déclaration enregistrée: ${c.declared_at}.` : ""} ${c.party ? `Affiliation enregistrée: ${c.party}.` : ""} Le statut official_candidate n'est utilisé qu'après publication de la liste du Conseil constitutionnel.`,
    sourceUrl:c.source || null, path:"data/corpus.json", documentStatus:"current", candidateStatus:c.status, publishedAt:c.declared_at || corpus.snapshot_date,
    topics:["candidat","candidature","statut",c.status,c.party||""]
  })),
  ...corpus.parties.map(p => ({
    id:`party:${p.id}`, kind:"party_profile", entityId:p.id, entityLabel:p.name, title:`Parti : ${p.name}`,
    text:`${p.name} est un parti ou mouvement suivi dans le corpus. Une plateforme de parti n'est jamais attribuée automatiquement à un candidat.`,
    sourceUrl:p.url || null, path:"data/corpus.json", documentStatus:"current", candidateStatus:null, publishedAt:corpus.snapshot_date, topics:["parti","mouvement","programme"]
  })),
  ...corpus.documents.map(d => ({
    id:d.id, kind:"document", entityId:d.entity, entityLabel:labelFor(d.entity), title:d.title,
    text:`${d.title}. ${d.summary} Type: ${d.type}. Statut documentaire: ${d.status}. Date: ${d.date || "non précisée"}.`,
    sourceUrl:d.source, path:d.path, documentStatus:d.status, candidateStatus:candidateStatus(d.entity), publishedAt:d.date, sourceTier:d.source_tier,
    topics:[d.type,d.status]
  })),
  ...corpus.proposals.map(p => ({
    id:p.id, kind:"proposal", entityId:p.entity, entityLabel:labelFor(p.entity), title:p.title,
    text:`Proposition documentée : ${p.title}. Thème: ${p.topic}. Degré de certitude: ${p.certainty}.`,
    sourceUrl:p.source, path:p.path, documentStatus:"current", candidateStatus:candidateStatus(p.entity), publishedAt:null, certainty:p.certainty, topics:[p.topic,"proposition"]
  }))
];

function scoreChunk(chunk, queryTokens, raw) {
  const hay = norm([chunk.title, chunk.text, chunk.entityLabel, ...(chunk.topics||[])].join(" "));
  let score = 0;
  for (const t of queryTokens) {
    if (hay.includes(t)) score += t.length >= 7 ? 5 : 3;
    if (norm(chunk.title).includes(t)) score += 3;
    if (norm(chunk.entityLabel).includes(t)) score += 4;
  }
  const phrase = norm(raw);
  if (phrase.length > 5 && hay.includes(phrase)) score += 10;
  if (/qui .*candidat|candidats|candidature/.test(norm(raw)) && chunk.kind === "candidate_status") score += 6;
  if (/compare|compar/.test(norm(raw)) && chunk.kind === "proposal") score += 2;
  return score;
}

export function retrieve(question, {limit=8}={}) {
  const q = tokens(question);
  const ranked = chunks.map(chunk => ({chunk, score:scoreChunk(chunk,q,question)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);
  return {
    results: ranked.map(({chunk,score}) => ({
      score,
      text:chunk.text,
      citation:{
        title:chunk.title, entityId:chunk.entityId, entityLabel:chunk.entityLabel, kind:chunk.kind,
        path:chunk.path, sourceUrl:chunk.sourceUrl, documentStatus:chunk.documentStatus,
        candidateStatus:chunk.candidateStatus, publishedAt:chunk.publishedAt,
        githubUrl:chunk.path === "data/corpus.json" ? `${REPO}/blob/main/data/corpus.json` : `${REPO}/blob/main/${chunk.path}`
      }
    })),
    debug:{queryTokens:q, candidates:chunks.length}
  };
}

export function getMeta() {
  return {snapshotDate:corpus.snapshot_date, counts:{candidates:corpus.candidates.length, parties:corpus.parties.length, documents:corpus.documents.length, proposals:corpus.proposals.length}};
}
