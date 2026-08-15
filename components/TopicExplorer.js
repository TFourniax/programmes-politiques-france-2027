"use client";

import { useEffect, useState } from "react";
import { CandidateIdentity, CoverageBadge, EvidenceList, ExplorerError, ExplorerIntro, ExplorerLoading, fetchExplorer, readSearchParams, writeSearchParams } from "./ExplorerShared.js";

export default function TopicExplorer({ onExplore, onNavigate }) {
  const [meta, setMeta] = useState(null);
  const [topicId, setTopicId] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedCandidate, setExpandedCandidate] = useState(null);

  useEffect(() => {
    let active = true;
    fetchExplorer({ view: "meta" }).then((data) => {
      if (!active) return;
      setMeta(data);
      const requested = readSearchParams().get("topic") || "";
      setTopicId(data.topics.some((topic) => topic.id === requested) ? requested : data.topics[0]?.id || "");
      setLoading(false);
    }).catch((err) => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!topicId) return;
    let active = true;
    setLoading(true);
    setError("");
    writeSearchParams("topics", { topic: topicId }, ["candidate", "c", "t"]);
    fetchExplorer({ view: "topic", id: topicId }).then((data) => {
      if (active) { setResult(data); setLoading(false); setExpandedCandidate(null); }
    }).catch((err) => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, [topicId]);

  if (error) return <ExplorerError error={error} />;
  if (!meta) return <ExplorerLoading />;

  return <section className="panel explorerPanel topicExplorer">
    <ExplorerIntro
      eyebrow="Explorateur thématique"
      title="Partir d’un sujet plutôt que d’un candidat"
      description="Le thème sélectionné distingue les sources personnelles, les programmes de parti attribuables aux candidats officiellement désignés, les simples contextes de parti et les données manquantes."
      aside={<label className="explorerSelectLabel"><span>Thème</span><select value={topicId} onChange={(event) => setTopicId(event.target.value)}>{meta.topics.map((topic) => <option value={topic.id} key={topic.id}>{topic.label}</option>)}</select></label>}
    />

    {loading && !result && <ExplorerLoading label="Analyse de la couverture du thème…" />}
    {result && <div className="topicResults">
      <div className="topicHero">
        <div><span className="answerEyebrow">{result.topic.label}</span><h4>{result.topic.description}</h4><p>{result.neutralityNote}</p></div>
        <div className="topicHeroActions"><button onClick={() => onExplore?.(result.topic.exploreQuestion)}>Comparer dans le chat ↗</button><button onClick={() => { writeSearchParams("quiz", { topic: result.topic.id }, ["candidate", "c", "t"]); onNavigate?.("quiz"); }}>Tester mes connaissances</button></div>
      </div>

      <div className="coverageSummaryGrid">
        <div><strong>{result.summary.documented}</strong><span>personnalités documentées</span></div>
        <div><strong>{result.summary.partial}</strong><span>couverture partielle</span></div>
        <div><strong>{result.summary.party_only}</strong><span>parti non attribuable</span></div>
        <div><strong>{result.summary.none}</strong><span>non documentées</span></div>
      </div>

      <section className="explorerSection">
        <div className="explorerSectionTitle"><div><span className="answerEyebrow">Personnalités</span><h4>Couverture du corpus sur ce thème</h4></div><p>L’ordre ci-dessous reflète uniquement le niveau de documentation disponible.</p></div>
        <div className="topicCandidateList">{result.candidates.map(({ candidate, coverage }) => <article className={`topicCandidateRow ${expandedCandidate === candidate.id ? "open" : ""}`} key={candidate.id}>
          <div className="topicCandidateSummary"><CandidateIdentity candidate={candidate} compact /><CoverageBadge level={coverage.level} compact /><span>{coverage.directSourceCount} personnelle(s){coverage.attributedPartySourceCount ? ` · ${coverage.attributedPartySourceCount} parti attribuée(s)` : coverage.partySourceCount ? ` · ${coverage.partySourceCount} parti` : ""}</span><button className="textButton" onClick={() => setExpandedCandidate(expandedCandidate === candidate.id ? null : candidate.id)}>{expandedCandidate === candidate.id ? "Fermer" : "Sources"}</button></div>
          {expandedCandidate === candidate.id && <div className="topicCandidateEvidence"><div><h5>Sources directement rattachées</h5><EvidenceList items={coverage.directEvidence} empty="Aucune source personnelle directe." /></div>{coverage.attributedPartyEvidence?.length > 0 ? <div><h5>Programme du parti attribué</h5><EvidenceList items={coverage.attributedPartyEvidence} context="attributed_party" /></div> : coverage.partyContext.length > 0 && <div><h5>Contexte du parti</h5><EvidenceList items={coverage.partyContext} context="party" /></div>}</div>}
        </article>)}</div>
      </section>

      <section className="explorerSection">
        <div className="explorerSectionTitle"><div><span className="answerEyebrow">Partis & mouvements</span><h4>Plateformes directement documentées</h4></div><p>La source reste toujours le parti, même lorsqu'un programme est attribuable à son candidat officiellement désigné.</p></div>
        {result.parties.length ? <div className="partyTopicGrid">{result.parties.map((row) => <article key={row.party.id} style={{"--party-color":row.party.color}}><div className="partyTopicTitle"><span className="partyDot" /><strong>{row.party.name}</strong><span>{row.evidence.length} source(s)</span></div><EvidenceList items={row.evidence} /></article>)}</div> : <div className="explorerEmpty">Aucune plateforme de parti trouvée sur ce thème dans le corpus actuel.</div>}
      </section>
    </div>}
  </section>;
}
