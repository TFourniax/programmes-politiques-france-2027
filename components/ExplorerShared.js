"use client";

export async function fetchExplorer(params = {}) {
  const search = new URLSearchParams(params);
  const response = await fetch(`/api/explorer?${search.toString()}`, { cache: "no-store" });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error("Réponse explorer invalide"); }
  if (!response.ok) throw new Error(data?.error || `Erreur HTTP ${response.status}`);
  return data;
}

export function readSearchParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function writeSearchParams(mode, updates = {}, clear = [], options = {}) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("mode", mode);
  clear.forEach((key) => url.searchParams.delete(key));
  Object.entries(updates).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) url.searchParams.delete(key);
    else url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  });
  const method = options.history === "push" ? "pushState" : "replaceState";
  window.history[method]({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export async function copyCurrentUrl() {
  if (typeof window === "undefined") return false;
  try {
    await navigator.clipboard.writeText(window.location.href);
    return true;
  } catch {
    return false;
  }
}

export function publicRecordStatus(value) {
  const labels = {
    current: "version actuelle",
    superseded: "version remplacée",
    withdrawn: "retiré",
    archived: "archivé",
    rejected: "écarté",
    draft: "brouillon",
    historical: "historique"
  };
  return value ? (labels[value] || "statut documenté") : "";
}

export function publicCertainty(value) {
  if (value === "explicit") return "formulation explicite";
  if (value === "explicit_but_conditional") return "explicite, sous condition";
  if (value === "explicit_but_underspecified") return "explicite, détails incomplets";
  return value ? "certitude documentée" : "";
}

export function publicSourceTier(value) {
  if (value === "tier_1_primary_official") return "source primaire officielle";
  if (value === "tier_2_primary_statement") return "déclaration primaire";
  if (value === "tier_3_reliable_secondary") return "source secondaire fiable";
  if (value === "tier_4_discovery") return "source de découverte";
  return value ? "source référencée" : "";
}

export function publicConfidence(value) {
  if (value === "high") return "niveau de preuve élevé";
  if (value === "medium") return "niveau de preuve moyen";
  if (value === "low") return "niveau de preuve faible";
  return value ? "niveau de preuve documenté" : "";
}

export function publicEvidenceKind(value) {
  if (value === "proposal") return "proposition";
  if (value === "document") return "document";
  if (value === "candidate_status") return "statut de candidature";
  return value ? "élément documenté" : "";
}

const COVERAGE = {
  documented: { label: "Documenté", detail: "faisceau de preuves suffisant" },
  partial: { label: "Partiel", detail: "au moins un élément attribuable" },
  party_only: { label: "Parti seulement", detail: "programme non attribuable à cette personnalité" },
  none: { label: "Non documenté", detail: "aucune source attribuable trouvée" }
};

export function CoverageBadge({ level, compact = false }) {
  const item = COVERAGE[level] || COVERAGE.none;
  return <span className={`coverageBadge coverage-${level || "none"}`} title={item.detail}>{compact ? item.label : <><b>{item.label}</b><small>{item.detail}</small></>}</span>;
}

export function CandidateIdentity({ candidate, compact = false }) {
  if (!candidate) return null;
  return <div className={`candidateIdentity ${compact ? "compact" : ""}`} style={{"--party-color":candidate.partyColor || "#748196"}}>
    <span className="partyDot" />
    <div><strong>{candidate.name}</strong><small>{candidate.partyName || "Sans parti principal enregistré"}</small></div>
    {!compact && <span className="statusBadge">{candidate.statusLabel}</span>}
  </div>;
}

function EvidenceItem({ item }) {
  return <article className="explorerEvidence">
    <div className="explorerEvidenceTop"><strong>{item.title}</strong><span>{publicEvidenceKind(item.kind)}</span></div>
    {item.excerpt && <p>{item.excerpt}</p>}
    <div className="evidenceMeta">
      {item.publishedAt && <span>{item.publishedAt}</span>}
      {item.documentStatus && <span>{publicRecordStatus(item.documentStatus)}</span>}
      {item.certainty && <span>{publicCertainty(item.certainty)}</span>}
      {item.sourceTier && <span>{publicSourceTier(item.sourceTier)}</span>}
      {item.attributionBasis === "official_party_programme" && <span>attribué via candidature officielle du parti</span>}
    </div>
    <div className="sourceLinks">
      {item.githubUrl && <a href={item.githubUrl} target="_blank" rel="noreferrer">Voir dans le corpus ↗</a>}
      {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Source originale ↗</a>}
    </div>
  </article>;
}

export function EvidenceList({ items = [], context = "direct", empty = "Aucun élément trouvé." }) {
  if (!items.length) return <div className="explorerEmpty">{empty}</div>;
  const partyContext = context === "party";
  const attributedParty = context === "attributed_party";
  return <div className={`evidenceList ${partyContext || attributedParty ? "partyContextList" : ""}`}>
    {partyContext && <div className="partyContextWarning"><strong>Contexte du parti</strong><span>Ces éléments restent au niveau du parti : la personnalité n'est pas officiellement désignée pour porter ce programme.</span></div>}
    {attributedParty && <div className="partyContextWarning"><strong>Programme du parti attribuable</strong><span>La personnalité est officiellement désignée par ce parti. La provenance de chaque mesure reste le document du parti.</span></div>}
    {items.map((item) => <EvidenceItem item={item} key={`${item.id}-${item.path}`} />)}
  </div>;
}

export function ExplorerLoading({ label = "Chargement des données du corpus…" }) {
  return <section className="panel explorerState"><span className="loadingDot" />{label}</section>;
}

export function ExplorerError({ error }) {
  return <section className="panel explorerState explorerError">Impossible de charger cette vue : {error}</section>;
}

export function ExplorerIntro({ eyebrow, title, description, aside }) {
  return <div className="explorerIntro">
    <div><span className="answerEyebrow">{eyebrow}</span><h3>{title}</h3><p>{description}</p></div>
    {aside && <div className="explorerIntroAside">{aside}</div>}
  </div>;
}
