"use client";

import { useEffect, useRef, useState } from "react";
import IssueCompass from "./IssueCompass.js";

const EXAMPLES = [
  "Qui est déclaré candidat à ce stade ?",
  "Que propose le corpus sur les retraites ?",
  "Compare les positions documentées sur l'Union européenne",
  "Quelles propositions fiscales sont actuellement sourcées ?"
];

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

function SourceRefs({ numbers = [] }) {
  if (!numbers.length) return null;
  return <div className="answerSources">{numbers.map(number => <span key={number}>Source {number}</span>)}</div>;
}

function AnswerCard({ card }) {
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
    <SourceRefs numbers={card.sourceNumbers} />
    {card.sourceUrl && <a className="cardSourceLink" href={card.sourceUrl} target="_blank" rel="noreferrer">Vérifier la source ↗</a>}
  </article>;
}

function StructuredAnswer({ answer, onFollowUp }) {
  if (!answer || typeof answer !== "object") return null;
  return <div className={`structuredAnswer layout-${answer.layout || "overview"}`}>
    <div className="answerHeading"><span className="answerEyebrow">Réponse du corpus</span><h4>{answer.title}</h4>{answer.summary && <p>{answer.summary}</p>}</div>
    {answer.sections?.length > 0 && <div className="answerSections">{answer.sections.map((section,index)=><section className="answerSection" key={`${section.title}-${index}`}>
      {section.title && <h5>{section.title}</h5>}
      {section.text && <p>{section.text}</p>}
      {section.bullets?.length > 0 && <ul className="answerBullets">{section.bullets.map((bullet,i)=><li key={i}>{bullet}</li>)}</ul>}
      <SourceRefs numbers={section.sourceNumbers} />
    </section>)}</div>}
    {answer.cards?.length > 0 && <div className={`answerGrid ${answer.layout === "comparison" ? "comparisonGrid" : ""}`}>{answer.cards.map((card,index)=><AnswerCard card={card} key={`${card.entityId || card.title}-${index}`} />)}</div>}
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

export default function ChatApp() {
  const [meta, setMeta] = useState(null);
  const [apiStatus, setApiStatus] = useState("checking");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [citations, setCitations] = useState([]);
  const [mode, setMode] = useState("chat");
  const [answerScrollSignal, setAnswerScrollSignal] = useState(0);
  const [messages, setMessages] = useState([{role:"assistant", text:"Posez une question sur les candidatures, programmes ou propositions actuellement documentés. Je réponds uniquement à partir du corpus de ce dépôt et je montre les sources utilisées."}]);
  const messagesRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    fetchJson("/api/meta").then(data => { if (mounted) { setMeta(data); setApiStatus("ready"); } }).catch(() => { if (mounted) setApiStatus("error"); });
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
    setQuestion("");
    setMessages(m => [...m, {role:"user", text:value}]);
    setLoading(true);
    try {
      const data = await fetchJson("/api/chat", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question:value,history})});
      setApiStatus("ready");
      setCitations(data.citations || []);
      setMessages(m => [...m, {role:"assistant", answer:data.answer, meta:data.generated === false ? "Organisation déterministe à partir du corpus" : "Synthèse OpenAI strictement limitée aux éléments du corpus"}]);
      setAnswerScrollSignal(value => value + 1);
    } catch (error) {
      setApiStatus("error");
      setMessages(m => [...m, {role:"assistant", text:`Impossible de répondre : ${error.message}`}]);
      setAnswerScrollSignal(value => value + 1);
    } finally { setLoading(false); }
  }

  function exploreFromCompass(prompt) {
    setMode("chat");
    setTimeout(() => ask(prompt), 0);
  }

  const counts = meta?.counts || {};
  const apiLabel = apiStatus === "ready" ? "API corpus prête" : apiStatus === "error" ? "API indisponible" : "vérification API…";

  return <main className="shell">
    <header className="header">
      <div className="brand"><div className="brandMark">27</div><div><h1>Programmes politiques · France 2027</h1><p>Corpus public & moteur de questions-réponses</p></div></div>
      <a className="headerLink" href="https://github.com/TFourniax/programmes-politiques-france-2027" target="_blank" rel="noreferrer">Voir le dépôt ↗</a>
    </header>
    <section className="hero">
      <div><span className="kicker">Source ouverte · versionnée · vérifiable</span><h2>Interrogez les programmes. Pas les slogans.</h2><p className="heroText">Une interface neutre pour rechercher et comparer ce qui est réellement documenté dans les programmes, projets, discours et déclarations suivis par le dépôt.</p></div>
      <div className="warning">Instantané <strong>{meta?.snapshotDate || "préélectoral"}</strong>. « Suivi », « déclaré », « investi » et « candidat officiel » sont des statuts différents. Les programmes peuvent encore évoluer.</div>
    </section>
    <section className="metrics">
      <div className="metric"><strong>{counts.candidates ?? "—"}</strong><span>personnalités suivies</span></div>
      <div className="metric"><strong>{counts.parties ?? "—"}</strong><span>partis & mouvements</span></div>
      <div className="metric"><strong>{counts.documents ?? "—"}</strong><span>documents indexés</span></div>
      <div className="metric"><strong>{counts.proposals ?? "—"}</strong><span>propositions atomiques</span></div>
    </section>
    <nav className="modeSwitcher" aria-label="Modes d'exploration">
      <button className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}><span>Questionner le corpus</span><small>Recherche libre & comparaisons</small></button>
      <button className={mode === "compass" ? "active" : ""} onClick={() => setMode("compass")}><span>Boussole des enjeux <b>Nouveau</b></span><small>Construire son parcours de lecture</small></button>
    </nav>
    {mode === "chat" ? <section className="workspace">
      <div className="panel">
        <div className="chatHeader"><h3>Questionner le corpus</h3><span className="status">{apiStatus === "ready" && <i />}{apiLabel}</span></div>
        <div className="messages" ref={messagesRef}>
          {messages.map((m,i) => <div data-answer-anchor={m.role === "assistant" && i > 0 ? "true" : undefined} className={`message ${m.role} ${m.answer ? "structuredMessage" : ""}`} key={i}>{m.answer ? <StructuredAnswer answer={m.answer} onFollowUp={ask} /> : m.text}{m.meta && <div className="messageMeta">{m.meta}</div>}</div>)}
          {loading && <div className="message assistant loadingMessage"><span className="loadingDot" />Recherche et organisation des éléments pertinents…</div>}
        </div>
        <div className="composer"><div className="inputWrap"><textarea value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();ask();}}} placeholder="Ex. Compare les positions documentées sur les retraites…"/><button className="send" onClick={()=>ask()} disabled={loading || !question.trim()}>↑</button></div><div className="examples">{EXAMPLES.map(x=><button className="example" key={x} onClick={()=>ask(x)}>{x}</button>)}</div></div>
      </div>
      <aside className="panel sourcesPanel"><div className="sourcesHeader"><h3>Sources utilisées</h3><span className="status">{citations.length ? `${citations.length} éléments` : "en attente"}</span></div><div className="sources">{citations.length ? citations.map((c,i)=><SourceCard citation={c} number={i+1} key={`${c.path}-${c.entityId || "source"}-${i}`}/>) : <div className="empty">Les fichiers du dépôt et les sources originales apparaîtront ici après votre première question. Le chatbot n’utilise pas le web en direct : sa base est le corpus versionné du projet.</div>}</div></aside>
    </section> : <IssueCompass onExplore={exploreFromCompass} />}
    <footer className="footer"><span>Le corpus et la Boussole des enjeux ne recommandent aucun candidat et ne jugent pas la faisabilité des mesures.</span><span><a href="https://github.com/TFourniax/programmes-politiques-france-2027/blob/main/METHODOLOGY.md" target="_blank">Méthodologie</a> · <a href="https://github.com/TFourniax/programmes-politiques-france-2027/blob/main/NEUTRALITY_CHARTER.md" target="_blank">Neutralité</a></span></footer>
  </main>;
}
