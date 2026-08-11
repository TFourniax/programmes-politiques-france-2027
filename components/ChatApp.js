"use client";

import { useEffect, useRef, useState } from "react";
import CandidateExplorer from "./CandidateExplorer.js";
import ComparisonExplorer from "./ComparisonExplorer.js";
import HistoryExplorer from "./HistoryExplorer.js";
import IssueCompass from "./IssueCompass.js";
import KnowledgeQuiz from "./KnowledgeQuiz.js";
import TopicExplorer from "./TopicExplorer.js";
import { writeSearchParams } from "./ExplorerShared.js";

const EXAMPLES = [
  "Qui est déclaré candidat à ce stade ?",
  "Que propose le corpus sur les retraites ?",
  "Compare les positions documentées sur l'Union européenne",
  "Quelles propositions fiscales sont actuellement sourcées ?"
];

const MODES = new Set(["chat", "compare", "candidates", "topics", "history", "compass", "quiz"]);

async function fetchJson(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!contentType.includes("application/json")) throw new Error(`API ${response.status} : réponse non JSON reçue de ${path}`);
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`API ${response.status} : JSON invalide reçu de ${path}`); }
  if (!response.ok) throw new Error(data?.error || `API HTTP ${response.status}`);
  return data;
}

function confidenceLabel(value) {
  if (value === "high") return "preuve élevée";
  if (value === "medium") return "preuve moyenne";
  if (value === "low") return "preuve faible";
  return value || "";
}

function SourceRefs({ numbers = [], onShowSources }) {
  if (!numbers.length) return null;
  return <div className="answerSources">{numbers.map(number => <button type="button" key={number} onClick={() => onShowSources?.([number])}>Source {number}</button>)}</div>;
}

function AnswerCard({ card, onShowSources }) {
  const candidate = card.entityType === "candidate";
  return <article className={`answerCard ${candidate ? "candidateCard" : ""}`} style={{"--party-color":card.partyColor || "#748196"}}>
    <div className="cardAccent" />
    <div className="answerCardTop">
      <div className="answerCardIdentity">
        {card.partyName && <span className="partyDot" />}
        <div><h5>{card.title}</h5>{card.subtitle && <p>{card.subtitle}</p>}</div>
      </div>
      {candidate && <span className="statusBadge">{card.statusLabel}</span>}
    </div>
    {card.summary && <p className="answerCardSummary">{card.summary}</p>}
    {card.bullets?.length > 0 && <ul className="answerBullets">{card.bullets.map((bullet,index)=><li key={index}>{bullet}</li>)}</ul>}
    <div className="answerCardMeta">
      {card.partyName && <span>{card.partyName}</span>}
      {card.confidence && <span>{confidenceLabel(card.confidence)}</span>}
      {candidate && !card.officialCandidate && <span>pas encore « candidat officiel »</span>}
    </div>
    <SourceRefs numbers={card.sourceNumbers} onShowSources={onShowSources} />
    {card.sourceUrl && <a className="cardSourceLink" href={card.sourceUrl} target="_blank" rel="noreferrer">Vérifier la source ↗</a>}
  </article>;
}

function StructuredAnswer({ answer, onFollowUp, onShowSources }) {
  if (!answer || typeof answer !== "object") return null;
  return <div className={`structuredAnswer layout-${answer.layout || "overview"}`}>
    <div className="answerHeading"><span className="answerEyebrow">Réponse du corpus</span><h4>{answer.title}</h4>{answer.summary && <p>{answer.summary}</p>}</div>
    {answer.sections?.length > 0 && <div className="answerSections">{answer.sections.map((section,index)=><section className="answerSection" key={`${section.title}-${index}`}>
      {section.title && <h5>{section.title}</h5>}
      {section.text && <p>{section.text}</p>}
      {section.bullets?.length > 0 && <ul className="answerBullets">{section.bullets.map((bullet,i)=><li key={i}>{bullet}</li>)}</ul>}
      <SourceRefs numbers={section.sourceNumbers} onShowSources={onShowSources} />
    </section>)}</div>}
    {answer.cards?.length > 0 && <div className={`answerGrid ${answer.layout === "comparison" ? "comparisonGrid" : ""}`}>{answer.cards.map((card,index)=><AnswerCard card={card} onShowSources={onShowSources} key={`${card.entityId || card.title}-${index}`} />)}</div>}
    {answer.note && <div className="answerNote">{answer.note}</div>}
    {answer.followUps?.length > 0 && <div className="followUpBlock"><span>Pour aller plus loin</span><div className="followUps">{answer.followUps.map(item=><button key={item} onClick={()=>onFollowUp(item)}>{item}<b>↗</b></button>)}</div></div>}
  </div>;
}

function SourceCard({ citation, number }) {
  return <div className="sourceCard">
    <span className="sourceNumber">SOURCE {String(number).padStart(2, "0")}</span>
    <strong>{citation.title}</strong>
    <p>{citation.entityLabel || citation.entityId || "Entité non précisée"}{citation.publishedAt ? ` · ${citation.publishedAt}` : ""}{citation.section ? ` · ${citation.section}` : ""}</p>
    <div className="sourceTags">
      {citation.kind && <span className="tag">{citation.kind}</span>}
      {citation.documentStatus && <span className="tag">{citation.documentStatus}</span>}
      {citation.proposalStatus && <span className="tag">proposition: {citation.proposalStatus}</span>}
      {citation.candidateStatus && <span className="tag">candidat: {citation.candidateStatus}</span>}
      {citation.confidence && <span className="tag">preuve: {citation.confidence}</span>}
      {citation.certainty && <span className="tag">certitude: {citation.certainty}</span>}
      {citation.sourceTier && <span className="tag">{citation.sourceTier}</span>}
    </div>
    <div className="sourceLinks">
      {citation.githubUrl && <a href={citation.githubUrl} target="_blank" rel="noreferrer">Fichier GitHub ↗</a>}
      {citation.sourceUrl && <a href={citation.sourceUrl} target="_blank" rel="noreferrer">Source originale ↗</a>}
    </div>
  </div>;
}

function messageHistoryContent(message) {
  if (message.text) return message.text;
  if (message.answer) return [message.answer.title,message.answer.summary].filter(Boolean).join(" — ");
  return "";
}

function latestSessionContext(messages) {
  return [...messages].reverse().find((message) => message?.sessionContext)?.sessionContext || {};
}

export default function ChatApp() {
  const [meta, setMeta] = useState(null);
  const [apiStatus, setApiStatus] = useState("checking");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [sourceView, setSourceView] = useState({ citations: [], numbers: null });
  const [mode, setMode] = useState("chat");
  const [answerScrollSignal, setAnswerScrollSignal] = useState(0);
  const [messages, setMessages] = useState([{role:"assistant", text:"Posez une question sur les candidatures, programmes ou propositions actuellement documentés. Je réponds uniquement à partir du corpus de ce dépôt et je montre les sources utilisées."}]);
  const messagesRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    fetchJson("/api/meta").then(data => { if (mounted) { setMeta(data); setApiStatus("ready"); } }).catch(() => { if (mounted) setApiStatus("error"); });
    if (typeof window !== "undefined") {
      const requested = new URLSearchParams(window.location.search).get("mode");
      if (MODES.has(requested)) setMode(requested);
      const onPopState = () => {
        const next = new URLSearchParams(window.location.search).get("mode") || "chat";
        setMode(MODES.has(next) ? next : "chat");
      };
      window.addEventListener("popstate", onPopState);
      return () => { mounted = false; window.removeEventListener("popstate", onPopState); };
    }
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!answerScrollSignal) return;
    const frame = requestAnimationFrame(() => {
      const container = messagesRef.current;
      if (!container) return;
      const anchors = container.querySelectorAll("[data-answer-anchor='true']");
      const target = anchors[anchors.length - 1];
      if (!target) return;
      container.scrollTo({ top: Math.max(0, target.offsetTop - 10), behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [answerScrollSignal]);

  async function ask(forced) {
    const value = String(forced ?? question).trim();
    if (!value || loading) return;
    const history = messages.slice(-6).map(message => ({role:message.role,content:messageHistoryContent(message)})).filter(item=>item.content);
    const sessionContext = latestSessionContext(messages);
    setQuestion("");
    setMessages(m => [...m, {role:"user", text:value}]);
    setLoading(true);
    try {
      const data = await fetchJson("/api/chat", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question:value,history,sessionContext})});
      setApiStatus("ready");
      const citations = data.citations || [];
      setSourceView({ citations, numbers: null });
      const metaText = data.retrievalAssisted
        ? "Compréhension assistée · résultats revalidés · réponse extractive"
        : "Organisation déterministe à partir du corpus";
      setMessages(m => [...m, {role:"assistant", answer:data.answer, citations, sessionContext:data.sessionContext || sessionContext, meta:metaText}]);
      setAnswerScrollSignal(value => value + 1);
    } catch (error) {
      setApiStatus("error");
      setMessages(m => [...m, {role:"assistant", text:`Impossible de répondre : ${error.message}`}]);
      setAnswerScrollSignal(value => value + 1);
    } finally { setLoading(false); }
  }

  function switchMode(next) {
    const safe = MODES.has(next) ? next : "chat";
    setMode(safe);
    writeSearchParams(safe);
  }

  function exploreFromFeature(prompt) {
    switchMode("chat");
    setTimeout(() => ask(prompt), 0);
  }

  const counts = meta?.counts || {};
  const apiLabel = apiStatus === "ready" ? "API corpus prête" : apiStatus === "error" ? "API indisponible" : "vérification API…";
  const visibleSources = sourceView.numbers?.length
    ? sourceView.numbers.map((number) => ({ number, citation: sourceView.citations[number - 1] })).filter((item) => item.citation)
    : sourceView.citations.map((citation, index) => ({ number: index + 1, citation }));

  let content;
  if (mode === "chat") {
    content = <section className="workspace">
      <div className="panel">
        <div className="chatHeader"><h3>Questionner le corpus</h3><span className="status">{apiStatus === "ready" && <i />}{apiLabel}</span></div>
        <div className="messages" ref={messagesRef}>
          {messages.map((m,i) => <div data-answer-anchor={m.role === "assistant" && i > 0 ? "true" : undefined} className={`message ${m.role} ${m.answer ? "structuredMessage" : ""}`} key={i}>{m.answer ? <StructuredAnswer answer={m.answer} onFollowUp={ask} onShowSources={(numbers) => setSourceView({ citations: m.citations || [], numbers })} /> : m.text}{m.meta && <div className="messageMeta">{m.meta}</div>}</div>)}
          {loading && <div className="message assistant loadingMessage"><span className="loadingDot" />Recherche et organisation des éléments pertinents…</div>}
        </div>
        <div className="composer"><div className="inputWrap"><textarea value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();ask();}}} placeholder="Ex. Compare les positions documentées sur les retraites…"/><button className="send" onClick={()=>ask()} disabled={loading || !question.trim()}>↑</button></div><div className="examples">{EXAMPLES.map(x=><button className="example" key={x} onClick={()=>ask(x)}>{x}</button>)}</div></div>
      </div>
      <aside className="panel sourcesPanel"><div className="sourcesHeader"><h3>Sources de la réponse sélectionnée</h3><span className="status">{visibleSources.length ? `${visibleSources.length} éléments` : "en attente"}</span></div><div className="sources">{visibleSources.length ? visibleSources.map(({citation,number})=><SourceCard citation={citation} number={number} key={`${citation.path}-${citation.entityId || "source"}-${number}`}/>) : <div className="empty">Chaque réponse conserve désormais ses propres sources. Cliquez sur « Source N » dans une réponse pour afficher exactement les documents qui la soutiennent.</div>}</div></aside>
    </section>;
  } else if (mode === "compare") content = <ComparisonExplorer onExplore={exploreFromFeature} />;
  else if (mode === "candidates") content = <CandidateExplorer onExplore={exploreFromFeature} onNavigate={switchMode} />;
  else if (mode === "topics") content = <TopicExplorer onExplore={exploreFromFeature} onNavigate={switchMode} />;
  else if (mode === "history") content = <HistoryExplorer />;
  else if (mode === "quiz") content = <KnowledgeQuiz onExplore={exploreFromFeature} />;
  else content = <IssueCompass onExplore={exploreFromFeature} />;

  return <main className="shell">
    <header className="header">
      <div className="brand"><div className="brandMark">27</div><div><h1>Programmes politiques · France 2027</h1><p>Corpus public & outils d’exploration sourcés</p></div></div>
      <a className="headerLink" href="https://github.com/TFourniax/programmes-politiques-france-2027" target="_blank" rel="noreferrer">Voir le dépôt ↗</a>
    </header>
    <section className="hero">
      <div><span className="kicker">Source ouverte · versionnée · vérifiable</span><h2>Comprendre avant de choisir.</h2><p className="heroText">Questionnez, comparez et explorez ce qui est réellement documenté dans les programmes, projets, discours et déclarations suivis par le dépôt — avec les sources, les anciennes versions et les lacunes visibles.</p></div>
      <div className="warning">Instantané <strong>{meta?.snapshotDate || "préélectoral"}</strong>. « Suivi », « déclaré », « investi » et « candidat officiel » sont des statuts différents. Une donnée absente du corpus n’est jamais interprétée comme une opposition.</div>
    </section>
    <section className="metrics">
      <div className="metric"><strong>{counts.candidates ?? "—"}</strong><span>personnalités suivies</span></div>
      <div className="metric"><strong>{counts.parties ?? "—"}</strong><span>partis & mouvements</span></div>
      <div className="metric"><strong>{counts.documents ?? "—"}</strong><span>documents indexés</span></div>
      <div className="metric"><strong>{counts.proposals ?? "—"}</strong><span>propositions atomiques</span></div>
    </section>
    <nav className="modeSwitcher modeSwitcherWide" aria-label="Modes d'exploration">
      <button className={mode === "chat" ? "active" : ""} onClick={() => switchMode("chat")}><span>Questionner</span><small>Recherche libre</small></button>
      <button className={mode === "compare" ? "active" : ""} onClick={() => switchMode("compare")}><span>Comparer</span><small>2 à 4 personnalités</small></button>
      <button className={mode === "candidates" ? "active" : ""} onClick={() => switchMode("candidates")}><span>Candidats</span><small>Fiches & timeline</small></button>
      <button className={mode === "topics" ? "active" : ""} onClick={() => switchMode("topics")}><span>Thèmes</span><small>Explorer un enjeu</small></button>
      <button className={mode === "history" ? "active" : ""} onClick={() => switchMode("history")}><span>Historique</span><small>Versions & évolutions</small></button>
      <button className={mode === "compass" ? "active" : ""} onClick={() => switchMode("compass")}><span>Boussole</span><small>Prioriser ses enjeux</small></button>
      <button className={mode === "quiz" ? "active" : ""} onClick={() => switchMode("quiz")}><span>Quiz</span><small>Vérifier sa compréhension</small></button>
    </nav>
    {content}
    <footer className="footer"><span>Les outils du site n’attribuent pas une plateforme de parti à un candidat sans source directe, ne recommandent aucun vote et ne jugent pas la faisabilité des mesures.</span><span><a href="https://github.com/TFourniax/programmes-politiques-france-2027/blob/main/METHODOLOGY.md" target="_blank">Méthodologie</a> · <a href="https://github.com/TFourniax/programmes-politiques-france-2027/blob/main/NEUTRALITY_CHARTER.md" target="_blank">Neutralité</a></span></footer>
  </main>;
}