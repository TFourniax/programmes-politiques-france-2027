import entities from "../data/entities.json" with { type: "json" };
import ontology from "../data/political-ontology.json" with { type: "json" };

const API_URL = process.env.LLM_API_URL || "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.LLM_FALLBACK_MODEL || process.env.LLM_MODEL || "gpt-5-mini";
const TIMEOUT_MS = Math.min(10000, Math.max(1000, Number(process.env.LLM_FALLBACK_TIMEOUT_MS || 5500)));
const ENABLED = process.env.LLM_RETRIEVAL_FALLBACK_ENABLED !== "false";
const FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60_000;

const entityById = new Map([
  ...entities.candidates.map((item) => [item.id, { ...item, type: "candidate" }]),
  ...entities.parties.map((item) => [item.id, { ...item, type: "party" }])
]);
const conceptById = new Map(ontology.concepts.map((item) => [item.id, item]));
const SAFE_ENTITY_ALIASES = new Map([
  ["parti-socialiste", ["ps"]],
  ["rassemblement-national", ["rn"]],
  ["la-france-insoumise", ["lfi"]],
  ["les-republicains", ["lr"]],
  ["pcf", ["pcf"]]
]);

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

const INTERPRETATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["understood", "confidence", "intent", "mappings", "numbers"],
  properties: {
    understood: { type: "boolean" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    intent: { type: "string", enum: ["overview", "measures", "comparison", "candidate_status"] },
    mappings: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "id", "evidence_span"],
        properties: {
          kind: { type: "string", enum: ["entity", "concept"] },
          id: { type: "string" },
          evidence_span: { type: "string", minLength: 3 }
        }
      }
    },
    numbers: { type: "array", maxItems: 4, items: { type: "string" } }
  }
};

function key() {
  const value = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  if (!value || value === "build-only-placeholder" || value === "test-placeholder") return "";
  return value;
}

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(value = "") {
  return normalize(value).split(/\s+/).filter(Boolean);
}

function unique(values, limit = 8) {
  return [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))].slice(0, limit);
}

function normalizedSource(question) {
  return String(question || "").toLocaleLowerCase("fr");
}

function groundedSpan(span, question) {
  const value = String(span || "").trim();
  return value.length >= 3 && normalizedSource(question).includes(value.toLocaleLowerCase("fr"));
}

function entityAliases(id) {
  const entity = entityById.get(id);
  if (!entity) return [];
  const aliases = new Set([normalize(entity.name), normalize(id), ...(SAFE_ENTITY_ALIASES.get(id) || []).map(normalize)]);
  if (entity.type === "candidate") {
    const last = normalize(entity.name).split(/\s+/).at(-1);
    if (last?.length >= 4) aliases.add(last);
  }
  return [...aliases].filter(Boolean);
}

function spanSupportsEntity(span, id) {
  const candidate = ` ${normalize(span)} `;
  return entityAliases(id).some((alias) => candidate.includes(` ${alias} `) || (alias.length >= 4 && ` ${alias} `.includes(candidate)));
}

const allEntityNameWords = new Set(
  [...entityById.keys()].flatMap((id) => entityAliases(id).flatMap(words))
);
const SEMANTIC_STOP = new Set(["quel","quelle","quels","quelles","propose","proposent","prevoit","veut","veulent","position","mesure","programme","projet","sur","pour","avec","dans","chez","concernant"]);

function spanSupportsConcept(span) {
  const meaningful = words(span).filter((word) => word.length >= 3 && !SEMANTIC_STOP.has(word) && !allEntityNameWords.has(word));
  return meaningful.length > 0;
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

function circuitOpen() {
  if (circuitOpenUntil && Date.now() >= circuitOpenUntil) {
    consecutiveFailures = 0;
    circuitOpenUntil = 0;
  }
  return circuitOpenUntil > Date.now();
}

function markSuccess() {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

function markFailure() {
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD) circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
}

export function retrievalFallbackStatus() {
  return {
    enabled: ENABLED,
    configured: Boolean(key()),
    model: MODEL,
    timeoutMs: TIMEOUT_MS,
    circuitOpen: circuitOpen(),
    consecutiveFailures
  };
}

export function shouldAttemptRetrievalFallback(debug = {}) {
  if (!ENABLED || circuitOpen()) return false;
  const reason = String(debug.reason || "");
  return reason === "insufficient_relevance" || reason === "empty_query";
}

export function sanitizeRetrievalInterpretation(raw, question) {
  if (!raw || typeof raw !== "object" || raw.understood !== true) return null;
  if (raw.confidence !== "high") return null;

  const mappings = [];
  const seen = new Set();
  for (const item of Array.isArray(raw.mappings) ? raw.mappings : []) {
    const kind = item?.kind;
    const id = String(item?.id || "").trim();
    const evidenceSpan = String(item?.evidence_span || "").trim();
    if (!groundedSpan(evidenceSpan, question)) continue;
    if (kind === "entity" && (!entityById.has(id) || !spanSupportsEntity(evidenceSpan, id))) continue;
    if (kind === "concept" && (!conceptById.has(id) || !spanSupportsConcept(evidenceSpan))) continue;
    if (!['entity', 'concept'].includes(kind)) continue;
    const pair = `${kind}:${id}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    mappings.push({ kind, id, evidenceSpan });
    if (mappings.length >= 8) break;
  }
  if (!mappings.length) return null;

  const entityIds = mappings.filter((item) => item.kind === "entity").map((item) => item.id);
  const conceptIds = mappings.filter((item) => item.kind === "concept").map((item) => item.id);
  const originalNumbers = numbersInQuestion(question);
  const numbers = unique(raw.numbers, 4)
    .map((value) => value.replace(/\D/g, ""))
    .filter((value) => value && originalNumbers.has(value));
  const intent = ["overview", "measures", "comparison", "candidate_status"].includes(raw.intent)
    ? raw.intent
    : "overview";

  if (!entityIds.length && !conceptIds.length) return null;
  if (intent === "comparison" && entityIds.length === 1) return null;
  if (intent === "candidate_status" && !entityIds.length) return null;

  return { confidence: "high", intent, entityIds, conceptIds, numbers, mappings };
}

export function withInheritedFallbackContext(interpretation, inheritedEntities = []) {
  if (!interpretation) return null;
  if (interpretation.entityIds?.length || !Array.isArray(inheritedEntities) || !inheritedEntities.length) return interpretation;
  const inheritedIds = inheritedEntities.map((item) => item?.id).filter((id) => entityById.has(id)).slice(0, 4);
  if (!inheritedIds.length) return interpretation;
  return { ...interpretation, entityIds: inheritedIds };
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
  if (circuitOpen()) return { attempted: false, interpretation: null, query: "", error: "fallback_circuit_open", model: MODEL };

  const system = `Tu es uniquement un classifieur sémantique de secours pour un moteur de recherche dans un corpus politique français 2027.
Tu ne réponds JAMAIS à la question et tu ne fournis AUCUN fait politique.
Ta seule tâche est de mapper la demande utilisateur vers des identifiants présents dans les catalogues fournis.
N'utilise aucune connaissance extérieure, n'invente aucun identifiant et n'ajoute aucun nombre absent de la question.
Pour CHAQUE identifiant proposé dans mappings, recopie dans evidence_span un fragment mot pour mot de la QUESTION ACTUELLE qui justifie précisément CET identifiant. Une entité ou un concept sans son propre fragment justificatif sera rejeté.
Pour une entité, le fragment doit contenir son nom ou son alias présent dans la question. Pour un concept, choisis le fragment sémantique de la question, pas le nom de l'acteur.
N'utilise jamais l'historique ou le catalogue dans evidence_span. L'historique sert uniquement à comprendre le contexte général.
Si le sens n'est pas suffisamment clair, mets understood=false ou confidence=medium/low.
Le serveur n'acceptera que confidence=high, vérifiera chaque mapping, puis revalidera la requête obtenue avec son moteur déterministe.`;

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
    if (interpretation) markSuccess();
    else markFailure();
    return {
      attempted: true,
      interpretation,
      query: buildFallbackRetrievalQuery(interpretation),
      model: MODEL,
      error: interpretation ? null : "fallback_not_confident"
    };
  } catch (error) {
    markFailure();
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