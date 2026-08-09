"use client";

import { useEffect, useMemo, useState } from "react";
import { CandidateIdentity, CoverageBadge, ExplorerError, ExplorerIntro, ExplorerLoading, copyCurrentUrl, fetchExplorer, readSearchParams, writeSearchParams } from "./ExplorerShared.js";

function MiniEvidence({ items = [], party = false }) {
  if (!items.length) return null;
  return <div className={`miniEvidence ${party ? "partyMiniEvidence" : ""}`}>
    {party && <span className="partyMiniLabel">Contexte du parti — non attribué automatiquement</span>}
    {items.slice(0, 2).map((item) => <div key={`${item.id}-${item.path}`}>
      <strong>{item.title}</strong>
      <p>{item.excerpt}</p>
      <div className="sourceLinks">{item.githubUrl && <a href={item.githubUrl} target="_blank" rel="noreferrer">GitHub ↗</a>}{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Source ↗</a>}</div>
    </div>)}
  </div>;
}

export default function ComparisonExplorer({ onExplore }) {
  const [meta, setMeta] = useState(null);
  const [slots, setSlots] = useState(["", "", "", ""]);
  const [topicIds, setTopicIds] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    fetchExplorer({ view: "meta" }).then((data) => {
      if (!active) return;
      setMeta(data);
      const params = readSearchParams();
      const requestedCandidates = (params.get("c") || "").split(",").filter((id) => data.candidates.some((candidate) => candidate.id === id)).slice(0, 4);
      const requestedTopics = (params.get("t") || "").split(",").filter((id) => data.topics.some((topic) => topic.id === id)).slice(0, 6);
      setSlots([...requestedCandidates, ...Array(4 - requestedCandidates.length).fill("")].slice(0, 4));
      setTopicIds(requestedTopics.length ? requestedTopics : data.topics.slice(0, 4).map((topic) => topic.id));
      setLoading(false);
    }).catch((err) => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, []);

  const candidateIds = useMemo(() => [...new Set(slots.filter(Boolean))], [slots]);
  const canCompare = candidateIds.length >= 2 && topicIds.length >= 1;

  useEffect(() => {
    if (!meta) return;
    writeSearchParams("compare", { c: candidateIds, t: topicIds }, ["candidate", "topic"]);
    if (!canCompare) { setComparison(null); return; }
    let active = true;
    setLoading(true);
    setError("");
    fetchExplorer({ view: "comparison", candidates: candidateIds.join(","), topics: topicIds.join(",") }).then((data) => {
      if (active) { setComparison(data); setLoading(false); }
    }).catch((err) => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, [meta, candidateIds.join("|"), topicIds.join("|")]);

  function updateSlot(index, value) {
    setSlots((current) => current.map((item, i) => i === index ? value : item));
  }

  function toggleTopic(id) {
    setTopicIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 6 ? [...current, id] : current);
  }

  async function share() {
    const ok = await copyCurrentUrl();
    setCopied(ok);
    setTimeout(() => setCopied(false), 1800);
  }

  if (error) return <ExplorerError error={error} />;
  if (!meta) return <ExplorerLoading />;

  const availableCandidates = meta.candidates.filter((candidate) => candidate.selectable);
  const selectedNames = comparison?.rows?.map((row) => row.candidate.name) || [];
  const selectedTopicLabels = comparison?.topics?.map((topic) => topic.label) || [];

  return <section className="panel explorerPanel comparisonExplorer">
    <ExplorerIntro
      eyebrow="Comparateur avancé"
      title="Comparer les positions réellement documentées"
      description="Choisissez 2 à 4 personnalités et jusqu’à 6 thèmes. Chaque case distingue les sources directement rattachées au candidat du contexte de son parti. Une absence de source ne vaut jamais opposition."
      aside={<div className="shareBox"><strong>Comparaison partageable</strong><span>La sélection est encodée dans l’URL, sans compte utilisateur ni profil politique enregistré.</span><button onClick={share}>{copied ? "Lien copié ✓" : "Copier le lien"}</button></div>}
    />

    <div className="comparisonControls">
      <div className="candidateSlots">
        {[0,1,2,3].map((index) => <label key={index}><span>{index < 2 ? `Candidat ${index + 1}` : `Candidat ${index + 1} (optionnel)`}</span><select value={slots[index]} onChange={(event) => updateSlot(index, event.target.value)}><option value="">Sélectionner…</option>{availableCandidates.map((candidate) => <option key={candidate.id} value={candidate.id} disabled={slots.some((item, slotIndex) => slotIndex !== index && item === candidate.id)}>{candidate.name} — {candidate.statusLabel}</option>)}</select></label>)}
      </div>
      <div className="topicPicker"><div><strong>Thèmes comparés</strong><span>{topicIds.length}/6 sélectionnés</span></div><div className="topicChips">{meta.topics.map((topic) => <button key={topic.id} className={topicIds.includes(topic.id) ? "active" : ""} onClick={() => toggleTopic(topic.id)} disabled={!topicIds.includes(topic.id) && topicIds.length >= 6}>{topic.label}</button>)}</div></div>
    </div>

    {!canCompare && <div className="explorerLanding"><strong>Choisissez au moins deux personnalités</strong><p>Le comparateur ne produit aucun score global : il expose les éléments sourcés, les zones de couverture partielle et les données manquantes thème par thème.</p></div>}
    {canCompare && loading && !comparison && <ExplorerLoading label="Construction de la comparaison…" />}

    {comparison && <div className="comparisonResults">
      <div className="comparisonToolbar"><div><strong>{comparison.rows.length} personnalités · {comparison.topics.length} thèmes</strong><span>Instantané {comparison.snapshotDate}</span></div><button onClick={() => onExplore?.(`Compare uniquement ${selectedNames.join(", ")} sur les thèmes suivants : ${selectedTopicLabels.join(", ")}. Distingue clairement les convergences, les divergences documentées et les informations manquantes, avec les sources du corpus.`)}>Analyser les divergences dans le chat ↗</button></div>

      <section className="comparisonSignals">
        <div className="explorerSectionTitle compactTitle"><div><span className="answerEyebrow">Lecture rapide</span><h4>Où la comparaison est solide — et où elle ne l’est pas</h4></div></div>
        <div className="signalGrid">{comparison.signals.map((signal) => <article key={signal.topicId}><strong>{signal.topicLabel}</strong>{signal.direct.length > 0 && <p><b>Sources directes :</b> {signal.direct.join(", ")}</p>}{signal.partyOnly.length > 0 && <p><b>Parti seulement :</b> {signal.partyOnly.join(", ")}</p>}{signal.missing.length > 0 && <p><b>Non documenté :</b> {signal.missing.join(", ")}</p>}{signal.completeForSelection && <span className="signalComplete">couverture directe pour toute la sélection</span>}</article>)}</div>
      </section>

      <div className="comparisonTableWrap">
        <table className="comparisonTable">
          <thead><tr><th>Personnalité</th>{comparison.topics.map((topic) => <th key={topic.id}><strong>{topic.label}</strong><small>{topic.description}</small></th>)}</tr></thead>
          <tbody>{comparison.rows.map((row) => <tr key={row.candidate.id}><th><CandidateIdentity candidate={row.candidate} compact /><span className="candidateStatusLine">{row.candidate.statusLabel}</span></th>{row.cells.map((cell) => <td key={cell.topicId}><CoverageBadge level={cell.level} compact />{cell.note && <p className="cellNote">{cell.note}</p>}<MiniEvidence items={cell.directEvidence} />{cell.partyContext.length > 0 && <MiniEvidence items={cell.partyContext} party />}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="answerNote">{comparison.neutralityNote}</div>
    </div>}
  </section>;
}
