"use client";

import { useEffect, useMemo, useState } from "react";
import { CandidateIdentity, CoverageBadge, EvidenceList, ExplorerError, ExplorerIntro, ExplorerLoading, fetchExplorer, publicConfidence, publicEvidenceKind, publicRecordStatus, readSearchParams, writeSearchParams } from "./ExplorerShared.js";

export default function CandidateExplorer({ onExplore, onNavigate }) {
  const [meta, setMeta] = useState(null);
  const [candidateId, setCandidateId] = useState("");
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedTopic, setExpandedTopic] = useState(null);

  useEffect(() => {
    let active = true;
    fetchExplorer({ view: "meta" }).then((data) => {
      if (!active) return;
      setMeta(data);
      const requested = readSearchParams().get("candidate") || "";
      if (requested && data.candidates.some((item) => item.id === requested)) setCandidateId(requested);
      setLoading(false);
    }).catch((err) => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!candidateId) { setProfile(null); return; }
    let active = true;
    setLoading(true);
    setError("");
    writeSearchParams("candidates", { candidate: candidateId }, ["c", "t", "topic"]);
    fetchExplorer({ view: "candidate", id: candidateId }).then((data) => {
      if (active) { setProfile(data); setLoading(false); }
    }).catch((err) => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, [candidateId]);

  const sortedCandidates = useMemo(() => meta?.candidates || [], [meta]);

  if (error) return <ExplorerError error={error} />;
  if (!meta || (loading && !candidateId)) return <ExplorerLoading />;

  return <section className="panel explorerPanel">
    <ExplorerIntro
      eyebrow="Fiches personnalités"
      title="Ce qui est documenté, et ce qui ne l’est pas"
      description="Chaque fiche sépare les positions directement rattachées à la personnalité des documents de son parti. Les absences de données restent visibles au lieu d’être interprétées."
      aside={<label className="explorerSelectLabel"><span>Choisir une personnalité</span><select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}><option value="">Sélectionner…</option>{sortedCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} — {candidate.statusLabel}</option>)}</select></label>}
    />

    {!candidateId && <div className="explorerLanding"><strong>Sélectionnez une personnalité</strong><p>Vous verrez son statut actuel, son niveau de couverture par thème, les documents directement associés, le contexte de parti séparé et la chronologie des positions documentées.</p></div>}

    {candidateId && loading && !profile && <ExplorerLoading label="Construction de la fiche personnalité…" />}

    {profile && <div className="candidateProfile">
      <div className="candidateProfileHero" style={{"--party-color":profile.candidate.partyColor || "#748196"}}>
        <CandidateIdentity candidate={profile.candidate} />
        <div className="candidateHeroMeta">
          <span>Statut au {profile.candidate.statusAsOf}</span>
          <span>{publicConfidence(profile.candidate.statusConfidence) || "niveau de preuve non renseigné"}</span>
          {profile.candidate.officialCandidate ? <b>candidat officiel</b> : <span>pas encore candidat officiel au sens du Conseil constitutionnel</span>}
        </div>
        <div className="candidateHeroActions">
          {profile.candidate.sourceUrl && <a href={profile.candidate.sourceUrl} target="_blank" rel="noreferrer">Source du statut ↗</a>}
          <button onClick={() => { writeSearchParams("compare", { c: [profile.candidate.id] }, ["candidate", "topic"]); onNavigate?.("compare"); }}>Ajouter à une comparaison</button>
          <button onClick={() => onExplore?.(`Que sait-on actuellement de ${profile.candidate.name} dans le corpus, et quelles informations manquent encore ?`)}>Interroger le corpus</button>
        </div>
      </div>

      <div className="coverageSummaryGrid">
        <div><strong>{profile.coverageSummary.documented}</strong><span>thèmes documentés</span></div>
        <div><strong>{profile.coverageSummary.partial}</strong><span>thèmes partiels</span></div>
        <div><strong>{profile.coverageSummary.party_only}</strong><span>parti seulement</span></div>
        <div><strong>{profile.coverageSummary.none}</strong><span>non documentés</span></div>
      </div>

      <section className="explorerSection">
        <div className="explorerSectionTitle"><div><span className="answerEyebrow">Couverture thématique</span><h4>Ce que le corpus permet réellement d’examiner</h4></div><p>{profile.neutralityNote}</p></div>
        <div className="coverageTopicGrid">
          {profile.coverage.map((item) => <article className={`coverageTopicCard ${expandedTopic === item.topicId ? "open" : ""}`} key={item.topicId}>
            <div className="coverageTopicTop"><div><strong>{item.topicLabel}</strong><small>{item.directSourceCount} source(s) directe(s) · {item.partySourceCount} source(s) de parti</small></div><CoverageBadge level={item.level} compact /></div>
            {item.note && <p>{item.note}</p>}
            <button className="textButton" onClick={() => setExpandedTopic(expandedTopic === item.topicId ? null : item.topicId)}>{expandedTopic === item.topicId ? "Masquer les éléments" : "Voir les éléments"}</button>
            {expandedTopic === item.topicId && <div className="coverageTopicEvidence">
              <h5>Directement rattaché à {profile.candidate.name}</h5>
              <EvidenceList items={item.directEvidence} empty="Aucune source directe sur ce thème." />
              {item.partyContext.length > 0 && <><h5>Contexte du parti</h5><EvidenceList items={item.partyContext} context="party" /></>}
            </div>}
          </article>)}
        </div>
      </section>

      <section className="explorerSection splitExplorerSection">
        <div>
          <div className="explorerSectionTitle compactTitle"><div><span className="answerEyebrow">Documents directs</span><h4>Sources rattachées à la personnalité</h4></div></div>
          <EvidenceList items={profile.directDocuments} empty="Aucun document ou proposition directement rattaché à cette personnalité dans le corpus actuel." />
        </div>
        <div>
          <div className="explorerSectionTitle compactTitle"><div><span className="answerEyebrow">Contexte du parti</span><h4>Documents du parti principal</h4></div></div>
          <EvidenceList items={profile.partyContextDocuments} context="party" empty="Aucun document de parti indexé." />
        </div>
      </section>

      <section className="explorerSection">
        <div className="explorerSectionTitle"><div><span className="answerEyebrow">Chronologie</span><h4>Évolution des éléments documentés</h4></div><p>La timeline reprend les dates présentes dans le corpus. Elle n’invente pas de changement de position lorsqu’aucun document ne le démontre.</p></div>
        <div className="timeline">
          {profile.timeline.map((event, index) => <article className="timelineEvent" key={`${event.type}-${event.date}-${event.title}-${index}`}>
            <div className="timelineDate">{event.date || "date non renseignée"}</div>
            <div className="timelineDot" />
            <div className="timelineBody"><div><strong>{event.title}</strong><span>{publicEvidenceKind(event.type)}{event.documentStatus ? ` · ${publicRecordStatus(event.documentStatus)}` : ""}</span></div>{event.excerpt && <p>{event.excerpt}</p>}<div className="sourceLinks">{event.githubUrl && <a href={event.githubUrl} target="_blank" rel="noreferrer">Voir dans le corpus ↗</a>}{event.sourceUrl && <a href={event.sourceUrl} target="_blank" rel="noreferrer">Source originale ↗</a>}</div></div>
          </article>)}
        </div>
      </section>
    </div>}
  </section>;
}
