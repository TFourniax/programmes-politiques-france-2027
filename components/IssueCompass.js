"use client";

import { useMemo, useState } from "react";
import compass from "../data/compass.json";
import { publicSourceTier } from "./ExplorerShared.js";

async function fetchJson(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!contentType.includes("application/json")) throw new Error(`API ${response.status} : réponse non JSON`);
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data?.error || `API HTTP ${response.status}`);
  return data;
}

function coverageLabel(coverage) {
  if (coverage?.level === "good") return "couverture correcte";
  if (coverage?.level === "partial") return "couverture partielle";
  return "couverture limitée";
}

function EvidenceCard({ card, citations = [] }) {
  const candidate = card.entityType === "candidate";
  const sourceNumber = card.sourceNumbers?.[0];
  const source = sourceNumber ? citations[sourceNumber - 1] : null;
  return <article className={`answerCard compassEvidenceCard ${candidate ? "candidateCard" : ""}`} style={{"--party-color":card.partyColor || "#748196"}}>
    <div className="cardAccent" />
    <div className="answerCardTop">
      <div className="answerCardIdentity">
        {card.partyName && <span className="partyDot" />}
        <div><h5>{card.title}</h5>{card.partyName && <p>{card.partyName}</p>}</div>
      </div>
      {candidate && card.statusLabel && <span className="statusBadge">{card.statusLabel}</span>}
    </div>
    {card.summary && <p className="answerCardSummary">{card.summary}</p>}
    <div className="answerCardMeta">
      {source?.sourceTier && <span>{publicSourceTier(source.sourceTier)}</span>}
      {source?.publishedAt && <span>{source.publishedAt}</span>}
    </div>
    <div className="sourceLinks compassSourceLinks">
      {source?.githubUrl && <a href={source.githubUrl} target="_blank" rel="noreferrer">Voir dans le corpus ↗</a>}
      {source?.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer">Source originale ↗</a>}
    </div>
  </article>;
}

export default function IssueCompass({ onExplore }) {
  const [answers, setAnswers] = useState(() => Object.fromEntries(compass.questions.map((question) => [question.id, null])));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const answeredCount = useMemo(() => Object.values(answers).filter((value) => Number.isInteger(value)).length, [answers]);
  const decisiveCount = useMemo(() => Object.values(answers).filter((value) => Number(value) > 0).length, [answers]);
  const complete = answeredCount === compass.questions.length && decisiveCount >= 3;

  function choose(id, value) {
    setAnswers((current) => ({ ...current, [id]: value }));
    setError("");
  }

  async function submit() {
    if (!complete || loading) return;
    setLoading(true);
    setError("");
    try {
      const payload = { answers: compass.questions.map((question) => ({ id: question.id, value: answers[question.id] })) };
      const data = await fetchJson("/api/compass", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function restart() {
    setResult(null);
    setError("");
  }

  if (result) {
    return <section className="compassPanel panel">
      <div className="compassResultHero">
        <div><span className="answerEyebrow">Boussole des enjeux</span><h3>{result.title}</h3><p>{result.summary}</p></div>
        <button className="secondaryButton" onClick={restart}>Modifier mes priorités</button>
      </div>
      <div className="compassTransparency"><strong>Pas de recommandation de vote.</strong> Les thèmes sont ordonnés selon vos réponses ; les candidats ne sont ni notés ni classés. {result.privacy}</div>
      <div className="priorityStack">
        {result.topics.map((topic) => <section className="priorityTopic" key={topic.id}>
          <div className="priorityHeader">
            <div className="priorityRank">{topic.rank}</div>
            <div className="priorityTitle"><span>{topic.importanceLabel}</span><h4>{topic.label}</h4><p>{topic.description}</p></div>
            <div className={`coverageBadge coverage-${topic.coverage.level}`}>{coverageLabel(topic.coverage)} · {topic.coverage.entities} entité{topic.coverage.entities > 1 ? "s" : ""}</div>
          </div>
          {topic.answer.cards?.length > 0 ? <div className="answerGrid compassEvidenceGrid">
            {topic.answer.cards.slice(0, 6).map((card, index) => <EvidenceCard key={`${topic.id}-${card.entityId || card.title}-${index}`} card={card} citations={topic.citations} />)}
          </div> : <div className="coverageGap"><strong>Corpus encore insuffisant sur ce thème.</strong><span>Cette absence est affichée telle quelle : elle ne signifie pas qu’un candidat n’a pas de position, seulement que le dépôt ne la documente pas encore assez.</span></div>}
          <div className="priorityActions">
            <button className="primaryGhostButton" onClick={() => onExplore(topic.exploreQuestion)}>Approfondir ce thème dans le chat <b>↗</b></button>
            <span>{topic.coverage.sources} source{topic.coverage.sources > 1 ? "s" : ""} retrouvée{topic.coverage.sources > 1 ? "s" : ""} · {topic.coverage.primarySources} primaire{topic.coverage.primarySources > 1 ? "s" : ""}</span>
          </div>
        </section>)}
      </div>
    </section>;
  }

  return <section className="compassPanel panel">
    <div className="compassIntro">
      <div><span className="answerEyebrow">Nouveau mode</span><h3>{compass.title}</h3><p>{compass.description}</p></div>
      <div className="compassRules"><strong>Le principe</strong><span>Vous indiquez l’importance de chaque enjeu. Le site construit ensuite un parcours de lecture à partir du corpus, sans calculer de candidat « idéal ».</span><small>Aucune réponse n’est stockée par le module.</small></div>
    </div>
    <div className="compassProgress"><div><strong>{answeredCount}/{compass.questions.length}</strong><span>thèmes renseignés</span></div><div className="progressTrack"><i style={{width:`${(answeredCount / compass.questions.length) * 100}%`}} /></div></div>
    <div className="questionnaireGrid">
      {compass.questions.map((question, index) => <article className={`compassQuestion ${Number.isInteger(answers[question.id]) ? "answered" : ""}`} key={question.id}>
        <div className="questionNumber">{String(index + 1).padStart(2, "0")}</div>
        <div className="questionCopy"><h4>{question.label}</h4><p>{question.question}</p><small>{question.description}</small></div>
        <div className="importanceScale" role="group" aria-label={`Importance de ${question.label}`}>
          {compass.scale.map((option) => <button key={option.value} className={answers[question.id] === option.value ? "selected" : ""} onClick={() => choose(question.id, option.value)}><b>{option.value}</b><span>{option.label}</span></button>)}
        </div>
      </article>)}
    </div>
    <div className="compassFooter">
      <div>{error ? <span className="compassError">{error}</span> : <span>Renseignez les 10 thèmes et gardez au moins trois sujets non secondaires.</span>}</div>
      <button className="compassSubmit" disabled={!complete || loading} onClick={submit}>{loading ? "Analyse du corpus…" : "Construire mon parcours de lecture"}</button>
    </div>
  </section>;
}