"use client";

import { useEffect, useMemo, useState } from "react";
import { ExplorerError, ExplorerIntro, ExplorerLoading, readSearchParams, writeSearchParams } from "./ExplorerShared.js";

async function fetchHistory(params = {}) {
  const search = new URLSearchParams(params);
  const response = await fetch(`/api/history?${search.toString()}`, { cache: "no-store" });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error("Réponse historique invalide"); }
  if (!response.ok) throw new Error(data?.error || `Erreur HTTP ${response.status}`);
  return data;
}

function signalLabel(value) {
  if (value === "replaces_previous") return "remplace une version antérieure";
  if (value === "replaced_by_newer") return "remplacée par une version plus récente";
  if (value === "current_snapshot") return "version active";
  return "archive du corpus";
}

function relationText(event) {
  const parts = [];
  if (event.supersedes?.length) parts.push(`Remplace : ${event.supersedes.map((item) => item.title).join(" · ")}`);
  if (event.supersededBy?.length) parts.push(`Remplacée par : ${event.supersededBy.map((item) => item.title).join(" · ")}`);
  return parts;
}

function recordsLabel(count) {
  return `${count} élément${count > 1 ? "s" : ""}`;
}

export default function HistoryExplorer() {
  const [meta, setMeta] = useState(null);
  const [actorId, setActorId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchHistory({ view: "meta" }).then((data) => {
      if (!active) return;
      setMeta(data);
      const params = readSearchParams();
      const requestedActor = params.get("history_actor") || "";
      const requestedTopic = params.get("history_topic") || "";
      if (requestedActor && data.actors.some((item) => item.id === requestedActor)) setActorId(requestedActor);
      if (requestedTopic && data.topics.some((item) => item.id === requestedTopic)) setTopicId(requestedTopic);
      setLoading(false);
    }).catch((err) => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!actorId) { setTimeline(null); return; }
    let active = true;
    setLoading(true);
    setTimeline(null);
    setError("");
    writeSearchParams("history", { history_actor: actorId, history_topic: topicId }, ["candidate", "c", "t", "topic"]);
    fetchHistory({ view: "timeline", entity: actorId, ...(topicId ? { topic: topicId } : {}) }).then((data) => {
      if (active) { setTimeline(data); setLoading(false); }
    }).catch((err) => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, [actorId, topicId]);

  const actors = useMemo(() => meta?.actors || [], [meta]);
  const topics = useMemo(() => meta?.topics || [], [meta]);

  if (error) return <ExplorerError error={error} />;
  if (!meta || (loading && !actorId)) return <ExplorerLoading label="Chargement des versions du corpus…" />;

  const filters = <div className="historyFilters">
    <label className="explorerSelectLabel"><span>Acteur</span><select value={actorId} onChange={(event) => setActorId(event.target.value)}><option value="">Sélectionner…</option>{actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name} — {actor.type === "candidate" ? "personnalité" : "parti"}</option>)}</select></label>
    <label className="explorerSelectLabel"><span>Thème</span><select value={topicId} onChange={(event) => setTopicId(event.target.value)}><option value="">Tous les thèmes</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.label}</option>)}</select></label>
  </div>;

  return <section className="panel explorerPanel">
    <ExplorerIntro
      eyebrow="Historique des positions"
      title="Voir les versions, les retraits et les évolutions documentées"
      description="Cette vue sépare l’état actuel du corpus de ses anciennes versions. Une évolution n’est affirmée que lorsqu’un lien de version ou une source datée la documente ; une simple différence de date n’est jamais interprétée comme un revirement."
      aside={filters}
    />

    {!actorId && <div className="explorerLanding"><strong>Choisissez un candidat, une personnalité ou un parti</strong><p>Le dépôt conserve les anciennes versions au lieu de les effacer. Vous pouvez ainsi retrouver une proposition remplacée, voir ce qui est encore actif et suivre les chaînes de version lorsqu’elles sont explicitement documentées.</p><div className="coverageSummaryGrid"><div><strong>{meta.counts.current}</strong><span>versions actives</span></div><div><strong>{meta.counts.historical}</strong><span>versions historiques</span></div><div><strong>{meta.counts.records}</strong><span>documents & propositions</span></div></div></div>}

    {actorId && loading && !timeline && <ExplorerLoading label="Construction de la chronologie…" />}

    {timeline && <div className="candidateProfile">
      <div className="candidateProfileHero" style={{"--party-color":"#748196"}}>
        <span className="answerEyebrow">{timeline.actor.type === "candidate" ? "Personnalité" : "Parti ou mouvement"}</span>
        <h3>{timeline.actor.name}</h3>
        <p>{timeline.topic ? `Historique filtré sur « ${timeline.topic.label} ».` : "Historique de tous les thèmes documentés pour cet acteur."}</p>
        <div className="coverageSummaryGrid">
          <div><strong>{timeline.summary.current}</strong><span>versions actives</span></div>
          <div><strong>{timeline.summary.historical}</strong><span>versions historiques</span></div>
          <div><strong>{timeline.summary.explicitVersionLinks}</strong><span>liens de version explicites</span></div>
          <div><strong>{timeline.summary.total}</strong><span>éléments affichés</span></div>
        </div>
        {timeline.partyContext && <div className="answerNote">Contexte séparé : {timeline.partyContext.name} possède {recordsLabel(timeline.partyContext.records)} sur ce périmètre. {timeline.partyContext.note}</div>}
      </div>

      <section className="explorerSection">
        <div className="explorerSectionTitle"><div><span className="answerEyebrow">Chronologie versionnée</span><h4>Évolution documentée</h4></div><p>{timeline.methodologyNote}</p></div>
        {!timeline.timeline.length && <div className="explorerEmpty">Aucun document ou proposition ne correspond à ce filtre dans le corpus actuel.</div>}
        <div className="timeline">
          {timeline.timeline.map((event, index) => <article className="timelineEvent" key={`${event.recordId}-${event.path}-${index}`}>
            <div className="timelineDate">{event.dateLabel || event.publishedAt || "date non renseignée"}</div>
            <div className="timelineDot" />
            <div className="timelineBody">
              <div><strong>{event.title}</strong><span>{event.kind === "proposal" ? "proposition" : "document"} · {event.status} · {signalLabel(event.evolutionSignal)}</span></div>
              {event.excerpt && <p>{event.excerpt}</p>}
              {relationText(event).map((text) => <div className="answerNote" key={text}>{text}</div>)}
              <div className="evidenceMeta">
                {event.certainty && <span>{event.certainty}</span>}
                {event.sourceTier && <span>{event.sourceTier}</span>}
                {event.confidence && <span>preuve {event.confidence}</span>}
              </div>
              <div className="sourceLinks">{event.githubUrl && <a href={event.githubUrl} target="_blank" rel="noreferrer">Fichier GitHub ↗</a>}{event.sourceUrl && <a href={event.sourceUrl} target="_blank" rel="noreferrer">Source originale ↗</a>}</div>
            </div>
          </article>)}
        </div>
      </section>
    </div>}
  </section>;
}
