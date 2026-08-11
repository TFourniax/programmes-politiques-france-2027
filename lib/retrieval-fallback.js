import entities from "../data/entities.json" with { type: "json" };
import ontology from "../data/political-ontology.json" with { type: "json" };

const API_URL = process.env.LLM_API_URL || "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.LLM_FALLBACK_MODEL || process.env.LLM_MODEL || "gpt-5-mini";
const TIMEOUT_MS = Number(process.env.LLM_FALLBACK_TIMEOUT_MS || 6000);
const ENABLED = process.env.LLM_RETRIEVAL_FALLBACK_ENABLED !== "false";

const entityById = new Map([
  ...entities.candidates.map((item) => [item.id, { ...item, type: "candidate" }]),
  ...entities.parties.map((item) => [item.id, { ...item, type: "party" }])
]);
const conceptById = new Map(ontology.concepts.map((item) => [item.id, item]));

const INTERPRETATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["understood", "confidence", "intent", "entity_ids", "concept_ids", "numbers", "evidence_spans"],
  properties: {
    understood: { type: "boolean" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    intent: { type: "string", enum: ["overview", "measures", "comparison", "candidate_status"] },
    entity_ids: { type: "array", maxItems: 4, items: { type: "string" } },
    concept_ids: { type: "array", maxItems: 4, items: { type: "string" } },
    numbers: { type: "array", maxItems: 4, items: { type: "string" } },
    evidence_spans: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } }
  }
};

function key() {
  const value = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  if (!value || value === "build-only-placeholder" || value === "test-placeholder") return "";
  return value;
}

function unique(values, limit = 4) {
  return [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))].slice(0, limit);
}

function numbersInQuestion(question) {
  return new Set(
    String(question || "")
      .replace(/[\u00a0\u202f]/g, " ")
      .match(/\d[\d\s.,]*/g)
      ?.map((value) => value.replace(/\D/g, ""))
      .filter(Boolean) || []
  );
}

function groundedSpans(rawSpans, question) {
  const source = String(question || "").toLocaleLowerCase("fr");
  return unique(rawSpans)
    .filter((span) => span.length >= 3)
    .filter((span) => source.includes(span.toLocaleLowerCase("fr")));
}

export function shouldAttemptRetrievalFallback(debug = {}) {
  if (!ENABLED) return false;
  const reason = String(debug.reason || "");
  return reason === "insufficient_relevance" || reason === "empty_query";
}

export function sanitizeRetrievalInterpretation(raw, question) {
  if (!raw || typeof raw !== "object" || raw.understood !== true) return null;
  if (raw.confidence !== "high") return null;

  const evidenceSpans = groundedSpans(raw.evidence_spans, question);
  if (!evidenceSpans.length) return null;

  const entityIds = unique(raw.entity_ids).filter((id) => entityById.has(id));
  const conceptIds = unique(raw.concept_ids).filter((id) => conceptById.has(id));
  const originalNumbers = numbersInQuestion(question);
  const numbers = unique(raw.numbers)
    .map((value) => value.replace(/\D/g, ""))
    .filter((value) => value && originalNumbers.has(value));
  const intent = ["overview", "measures", "comparison", "candidate_status"].includes(raw.intent)
    ? raw.intent
    : "overview";

  if (!entityIds.length && !conceptIds.length) return null;
  return { confidence: "high", intent, entityIds, conceptIds, numbers, evidenceSpans };
}

export function buildFallbackRetrievalQuery(interpretation) {
  if (!interpretation) return "";
  const entityNames = interpretation.entityIds.map((id) => entityById.get(id)?.name).filter(Boolean);
  const conceptLabels = interpretation.conceptIds.map((id) => conceptById.get(id)?.label).filter(Boolean);
  const numbers = interpretation.numbers || [];
  const actors = entityNames.join(" et ");
  const subject = [...conceptLabels, ...numbers].join(" ").trim();

  if (interpretation.intent === "candidate_status") {
    return `Statut de candidature ${actors || "présidentielle 2027"}`.trim();
  }
  if (interpretation.intent === "comparison") {
    return `Compare ${actors || "les positions documentées"}${subject ? ` sur ${subject}` : ""}`.trim();
  }
  if (entityNames.length) return `Que propose ${actors}${subject ? ` sur ${subject}` : ""} ?`;
  return `Quelles propositions documentées concernent ${subject} ?`;
}

function catalogue() {
  const entityLines = [...entityById.entries()]
    .map(([id, item]) => `${id} | ${item.name} | ${item.type}`)
    .join("\n");
  const conceptLines = ontology.concepts
    .map((item) => `${item.id} | ${item.label} | alias: ${(item.aliases || []).join(", ")}`)
    .join("\n");
  return `ENTITÉS AUTORISÉES:\n${entityLines}\n\nCONCEPTS AUTORISÉS:\n${conceptLines}`;
}

function conversation(history = []) {
  return (history || [])
    .filter((item) => item?.role === "user" && String(item.content || "").trim())
    .slice(-4)
    .map((item) => String(item.content).slice(0, 500))
    .join("\n");
}

export async function interpretRetrievalWithModel(question, history = []) {
  const apiKey = key();
  if (!apiKey) return { attempted: false, interpretation: null, query: "", error: "fallback_key_unavailable" };

  const system = `Tu es uniquement un classifieur sémantique de secours pour un moteur de recherche dans un corpus politique français 2027.
Tu ne réponds JAMAIS à la question et tu ne fournis AUCUN fait politique.
Ta seule tâche est de mapper la demande utilisateur vers des identifiants présents dans les catalogues fournis.
N'utilise aucune connaissance extérieure, n'invente aucun identifiant et n'ajoute aucun nombre absent de la question.
Pour evidence_spans, recopie mot pour mot entre 1 et 4 fragments de la QUESTION ACTUELLE qui justifient ton interprétation. N'utilise jamais l'historique ou le catalogue dans evidence_spans.
Si le sens n'est pas suffisamment clair, mets understood=false ou confidence=medium/low.
Le serveur n'acceptera que confidence=high, vérifiera que les evidence_spans sont réellement présents dans la question, puis revalidera le résultat avec son moteur déterministe.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: `QUESTION ACTUELLE:\n${String(question).slice(0, 1200)}\n\nQUESTIONS UTILISATEUR RÉCENTES (contexte seulement):\n${conversation(history) || "Aucune"}\n\n${catalogue()}`
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "retrieval_interpretation", strict: true, schema: INTERPRETATION_SCHEMA }
        },
        max_completion_tokens: 350
      })
    });
    if (!response.ok) throw new Error(`fallback_http_${response.status}`);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("fallback_empty_response");
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    const interpretation = sanitizeRetrievalInterpretation(parsed, question);
    return {
      attempted: true,
      interpretation,
      query: buildFallbackRetrievalQuery(interpretation),
      model: MODEL,
      error: interpretation ? null : "fallback_not_confident"
    };
  } catch (error) {
    return {
      attempted: true,
      interpretation: null,
      query: "",
      model: MODEL,
      error: error?.name === "AbortError" ? "fallback_timeout" : String(error?.message || "fallback_error")
    };
  } finally {
    clearTimeout(timeout);
  }
}
