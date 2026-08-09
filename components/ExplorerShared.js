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

export function writeSearchParams(mode, updates = {}, clear = []) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("mode", mode);
  clear.forEach((key) => url.searchParams.delete(key));
  Object.entries(updates).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) url.searchParams.delete(key);
    else url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  });
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
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

const COVERAGE = {
  documented: { label: "Documenté", detail: "au moins deux sources directes" },
  partial: { label: "Partiel", detail: "une source directe" },
  party_only: { label: "Parti seulement", detail: "aucune attribution personnelle" },
  none: { label: "Non documenté", detail: "aucune source directe trouvée" }
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
    <div className="explorerEvidenceTop"><strong>{item.title}</strong><span>{item.kind === "proposal" ? "proposition" : "document"}</span></div>
    {item.excerpt && <p>{item.excerpt}</p>}
    <div className="evidenceMeta">
      {item.publishedAt && <span>{item.publishedAt}</span>}
      {item.documentStatus && <span>{item.documentStatus}</span>}
      {item.certainty && <span>{item.certainty}</span>}
      {item.sourceTier && <span>{item.sourceTier}</span>}
    </div>
    <div className="sourceLinks">
      {item.githubUrl && <a href={item.githubUrl} target="_blank" rel="noreferrer">Fichier GitHub ↗</a>}
      {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Source originale ↗</a>}
    </div>
  </article>;
}

export function EvidenceList({ items = [], context = "direct", empty = "Aucun élément trouvé." }) {
  if (!items.length) return <div className="explorerEmpty">{empty}</div>;
  return <div className={`evidenceList ${context === "party" ? "partyContextList" : ""}`}>
    {context === "party" && <div className="partyContextWarning"><strong>Contexte du parti</strong><span>Ces éléments ne sont pas attribués automatiquement à la personnalité.</span></div>}
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
