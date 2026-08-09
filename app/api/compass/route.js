import { NextResponse } from "next/server";
import compass from "../../../data/compass.json" with { type: "json" };
import { retrieve } from "../../../lib/retrieval.js";
import { fallbackStructuredAnswer } from "../../../lib/presentation.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const questionById = new Map(compass.questions.map((question, index) => [question.id, { ...question, index }]));
const scaleByValue = new Map(compass.scale.map((item) => [item.value, item.label]));

function normalizeAnswers(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const output = [];
  for (const item of input) {
    const id = String(item?.id || "").trim();
    const value = Number(item?.value);
    if (!questionById.has(id) || seen.has(id) || !Number.isInteger(value) || value < 0 || value > 3) continue;
    seen.add(id);
    output.push({ id, value });
  }
  return output;
}

function relevantEvidence(query) {
  const retrieval = retrieve(query, { limit: 14, minScore: 1.8 });
  return retrieval.results
    .filter((item) => item.citation?.kind !== "candidate_status")
    .slice(0, 8);
}

function coverage(evidence) {
  const entityIds = new Set(evidence.map((item) => item.citation?.entityId).filter(Boolean));
  const primarySources = evidence.filter((item) => item.citation?.sourceTier === "tier_1_primary_official" || item.citation?.sourceTier === "tier_2_primary_statement").length;
  return {
    sources: evidence.length,
    entities: entityIds.size,
    primarySources,
    level: evidence.length >= 5 && entityIds.size >= 3 ? "good" : evidence.length >= 2 ? "partial" : "limited"
  };
}

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête JSON invalide." }, { status: 400 });
  }

  const answers = normalizeAnswers(payload?.answers);
  if (answers.length !== compass.questions.length) {
    return NextResponse.json({ error: `Répondez aux ${compass.questions.length} thèmes pour obtenir un parcours de lecture cohérent.` }, { status: 400 });
  }

  const ranked = answers
    .map((answer) => ({ ...questionById.get(answer.id), value: answer.value }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, 4);

  if (ranked.length < 3) {
    return NextResponse.json({ error: "Indiquez au moins trois thèmes à considérer, importants ou décisifs." }, { status: 400 });
  }

  const topics = ranked.map((theme, index) => {
    const evidence = relevantEvidence(theme.query);
    const answer = fallbackStructuredAnswer(theme.exploreQuestion, evidence, { mode: "measures" });
    return {
      id: theme.id,
      rank: index + 1,
      label: theme.label,
      description: theme.description,
      importance: theme.value,
      importanceLabel: scaleByValue.get(theme.value) || "",
      exploreQuestion: theme.exploreQuestion,
      coverage: coverage(evidence),
      answer: {
        ...answer,
        title: `Ce que le corpus documente sur ${theme.label.toLowerCase()}`,
        summary: evidence.length
          ? `Votre questionnaire place ce thème parmi vos priorités. Voici les éléments actuellement documentés dans le dépôt, sans score candidat ni recommandation de vote.`
          : `Ce thème fait partie de vos priorités, mais le corpus actuel ne contient pas encore assez d’éléments pour présenter une comparaison fiable.`,
        followUps: []
      },
      citations: evidence.map((item, sourceIndex) => ({ number: sourceIndex + 1, ...item.citation, score: item.score }))
    };
  });

  return NextResponse.json({
    title: "Votre parcours de lecture prioritaire",
    summary: "Les thèmes sont classés uniquement selon l’importance que vous leur avez donnée. Aucun score politique ou candidat n’est calculé.",
    privacy: "Vos réponses servent uniquement à générer ce résultat dans cette requête et ne sont pas enregistrées par cette API.",
    topics
  });
}
