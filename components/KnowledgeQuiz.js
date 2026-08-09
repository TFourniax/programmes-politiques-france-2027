"use client";

import { useEffect, useMemo, useState } from "react";
import { ExplorerError, ExplorerIntro, ExplorerLoading, fetchExplorer, readSearchParams, writeSearchParams } from "./ExplorerShared.js";

export default function KnowledgeQuiz({ onExplore }) {
  const [meta, setMeta] = useState(null);
  const [topicId, setTopicId] = useState("");
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [index, setIndex] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchExplorer({ view: "meta" }).then((data) => {
      if (!active) return;
      setMeta(data);
      const requested = readSearchParams().get("topic") || "";
      setTopicId(data.topics.some((topic) => topic.id === requested) ? requested : "");
      setLoading(false);
    }).catch((err) => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!meta) return;
    let active = true;
    setLoading(true);
    setError("");
    setAnswers({});
    setIndex(0);
    setReviewing(false);
    writeSearchParams("quiz", { topic: topicId || null }, ["candidate", "c", "t"]);
    fetchExplorer({ view: "quiz", topic: topicId || "" }).then((data) => {
      if (active) { setQuiz(data); setLoading(false); }
    }).catch((err) => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, [meta, topicId]);

  const score = useMemo(() => {
    if (!quiz) return 0;
    return quiz.questions.reduce((total, question) => total + (answers[question.id] === question.correctIndex ? 1 : 0), 0);
  }, [quiz, answers]);

  if (error) return <ExplorerError error={error} />;
  if (!meta) return <ExplorerLoading />;

  const questions = quiz?.questions || [];
  const done = questions.length > 0 && Object.keys(answers).length === questions.length;
  const question = questions[index];
  const selected = question ? answers[question.id] : undefined;
  const answered = selected !== undefined;
  const showQuestion = question && (!done || reviewing);

  return <section className="panel explorerPanel quizExplorer">
    <ExplorerIntro
      eyebrow="Quiz de compréhension"
      title="Vérifier ce qu’on a réellement retenu"
      description="Le quiz porte uniquement sur les faits enregistrés dans le corpus : statut d’une personnalité ou rattachement explicite d’un document. Il ne mesure ni idéologie, ni préférence, ni intention de vote."
      aside={<label className="explorerSelectLabel"><span>Portée du quiz</span><select value={topicId} onChange={(event) => setTopicId(event.target.value)}><option value="">Tous les thèmes</option>{meta.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.label}</option>)}</select></label>}
    />

    {loading && !quiz && <ExplorerLoading label="Préparation des questions…" />}
    {quiz && <div className="quizBody">
      <div className="quizTopline"><div><strong>{quiz.topic ? quiz.topic.label : "Quiz général"}</strong><span>{questions.length} questions · instantané {quiz.snapshotDate}</span></div><div className="quizProgressTrack"><i style={{width:`${questions.length ? (Object.keys(answers).length / questions.length) * 100 : 0}%`}} /></div></div>

      {showQuestion && <article className="quizCard">
        <div className="quizCounter">{reviewing ? "Relecture" : "Question"} {index + 1} / {questions.length}</div>
        <h4>{question.question}</h4>
        {question.prompt && <blockquote>{question.prompt}</blockquote>}
        <div className="quizOptions">{question.options.map((option, optionIndex) => {
          const isCorrect = answered && optionIndex === question.correctIndex;
          const isWrong = answered && optionIndex === selected && optionIndex !== question.correctIndex;
          return <button key={option} disabled={answered || reviewing} className={`${isCorrect ? "correct" : ""} ${isWrong ? "wrong" : ""}`} onClick={() => setAnswers((current) => ({...current, [question.id]: optionIndex}))}><span>{String.fromCharCode(65 + optionIndex)}</span>{option}</button>;
        })}</div>
        {answered && <div className={`quizExplanation ${selected === question.correctIndex ? "correct" : "wrong"}`}><strong>{selected === question.correctIndex ? "Bonne réponse" : "Réponse incorrecte"}</strong><p>{question.explanation}</p><div className="sourceLinks">{question.source?.githubUrl && <a href={question.source.githubUrl} target="_blank" rel="noreferrer">Vérifier dans GitHub ↗</a>}{question.source?.sourceUrl && <a href={question.source.sourceUrl} target="_blank" rel="noreferrer">Source originale ↗</a>}</div></div>}
        <div className="quizNav">
          <button disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>← Précédente</button>
          {reviewing && <button onClick={() => setReviewing(false)}>Retour au résultat</button>}
          {!reviewing && answered && index < questions.length - 1 && <button className="primaryAction" onClick={() => setIndex((value) => Math.min(questions.length - 1, value + 1))}>Question suivante →</button>}
          {reviewing && index < questions.length - 1 && <button className="primaryAction" onClick={() => setIndex((value) => Math.min(questions.length - 1, value + 1))}>Suivante →</button>}
        </div>
      </article>}

      {done && !reviewing && <div className="quizResult">
        <span className="answerEyebrow">Résultat</span><h3>{score} / {questions.length}</h3><p>Ce score mesure uniquement la compréhension des informations présentes dans le corpus. Il ne dit rien de votre orientation politique.</p>
        <div className="quizResultActions"><button onClick={() => { setAnswers({}); setIndex(0); setReviewing(false); }}>Recommencer</button>{quiz.topic && <button onClick={() => onExplore?.(`Explique-moi les principales positions actuellement documentées sur ${quiz.topic.label}, avec leurs sources et les informations encore manquantes.`)}>Approfondir ce thème dans le chat ↗</button>}</div>
        <div className="quizReview">{questions.map((item, itemIndex) => <button key={item.id} onClick={() => { setIndex(itemIndex); setReviewing(true); }} className={answers[item.id] === item.correctIndex ? "correct" : "wrong"}>{itemIndex + 1}<span>{answers[item.id] === item.correctIndex ? "✓" : "×"}</span></button>)}</div>
      </div>}
      <div className="answerNote">{quiz.note}</div>
    </div>}
  </section>;
}
