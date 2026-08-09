"use client";

import { useEffect, useRef, useState } from "react";

const EXAMPLES = [
  "Qui est déclaré candidat à ce stade ?",
  "Que propose le corpus sur les retraites ?",
  "Compare les positions documentées sur l'Union européenne",
  "Quelles propositions fiscales sont actuellement sourcées ?"
];

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

export default function ChatApp() {
  const [meta, setMeta] = useState(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [citations, setCitations] = useState([]);
  const [messages, setMessages] = useState([{role:"assistant", text:"Posez une question sur les candidatures, programmes ou propositions actuellement documentés. Je réponds uniquement à partir du corpus de ce dépôt et je montre les sources utilisées."}]);
  const bottomRef = useRef(null);

  useEffect(() => { fetch("/api/meta").then(r => r.json()).then(setMeta).catch(() => {}); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({behavior:"smooth"}); }, [messages, loading]);

  async function ask(forced) {
    const value = String(forced ?? question).trim();
    if (!value || loading) return;
    setQuestion("");
    setMessages(m => [...m, {role:"user", text:value}]);
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({question:value})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erreur lors de la réponse.");
      setCitations(data.citations || []);
      setMessages(m => [...m, {role:"assistant", text:data.answer, meta:data.generated === false ? "Réponse déterministe à partir du corpus" : "Réponse générée à partir des passages affichés"}]);
    } catch (error) {
      setMessages(m => [...m, {role:"assistant", text:`Impossible de répondre : ${error.message}`}]);
    } finally { setLoading(false); }
  }

  const counts = meta?.counts || {};
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
    <section className="workspace">
      <div className="panel">
        <div className="chatHeader"><h3>Questionner le corpus</h3><span className="status"><i />retrieval local actif</span></div>
        <div className="messages">
          {messages.map((m,i) => <div className={`message ${m.role}`} key={i}>{m.text}{m.meta && <div className="messageMeta">{m.meta}</div>}</div>)}
          {loading && <div className="message assistant">Recherche des passages pertinents…</div>}<div ref={bottomRef}/>
        </div>
        <div className="composer"><div className="inputWrap"><textarea value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();ask();}}} placeholder="Ex. Compare les positions documentées sur les retraites…"/><button className="send" onClick={()=>ask()} disabled={loading || !question.trim()}>↑</button></div><div className="examples">{EXAMPLES.map(x=><button className="example" key={x} onClick={()=>ask(x)}>{x}</button>)}</div></div>
      </div>
      <aside className="panel sourcesPanel"><div className="sourcesHeader"><h3>Sources utilisées</h3><span className="status">{citations.length ? `${citations.length} passages` : "en attente"}</span></div><div className="sources">{citations.length ? citations.map((c,i)=><SourceCard citation={c} number={i+1} key={`${c.path}-${i}`}/>) : <div className="empty">Les fichiers du dépôt et les sources originales apparaîtront ici après votre première question. Le chatbot n’utilise pas le web en direct : sa base est le corpus versionné du projet.</div>}</div></aside>
    </section>
    <footer className="footer"><span>Le corpus ne recommande aucun candidat et ne juge pas la faisabilité des mesures.</span><span><a href="https://github.com/TFourniax/programmes-politiques-france-2027/blob/main/METHODOLOGY.md" target="_blank">Méthodologie</a> · <a href="https://github.com/TFourniax/programmes-politiques-france-2027/blob/main/NEUTRALITY_CHARTER.md" target="_blank">Neutralité</a></span></footer>
  </main>;
}
