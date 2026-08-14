import { NextResponse } from "next/server";
import entities from "../../../data/entities.json" with { type: "json" };
import compass from "../../../data/compass.json" with { type: "json" };
import runtimeMeta from "../../../data/runtime-meta.json" with { type: "json" };

export const dynamic = "force-static";

const ACTIVE = new Set(["official_candidate","declared_presidential","party_designated","declared_primary","declared_conditional","exploratory"]);

export async function GET() {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://politique2027.netlify.app").replace(/\/$/, "");
  return NextResponse.json({
    schemaVersion: 1,
    election: entities.election,
    snapshotDate: entities.snapshot_date,
    generatedIndexAt: runtimeMeta.builtAt,
    counts: runtimeMeta.counts,
    canonicalRepository: "https://github.com/TFourniax/programmes-politiques-france-2027",
    sourceOfTruth: "versioned_markdown_yaml",
    canonicalData: [
      "registries/candidates.yaml",
      "registries/documents.yaml",
      "corpus/2027/**/*.md",
      "proposals/**/*.md"
    ],
    discoveryViews: [
      "data/entities.json",
      "data/compass.json",
      "generated/catalog.jsonl",
      `${siteUrl}/api/open-data`
    ],
    methodology: {
      sourcePriority: "primary_first",
      answerGeneration: "deterministic_extractive",
      candidatePartyAttribution: "separate_unless_directly_sourced",
      absenceRule: "missing_from_corpus_is_not_a_political_position",
      historicalRule: "superseded_withdrawn_archived_records_are_excluded_from_current_answers"
    },
    publicEndpoints: {
      candidates: `${siteUrl}/candidats`,
      topics: `${siteUrl}/themes`,
      coverage: `${siteUrl}/donnees`,
      llms: `${siteUrl}/llms.txt`,
      health: `${siteUrl}/api/health`
    },
    activeCandidates: entities.candidates.filter(candidate => ACTIVE.has(candidate.current_status)).map(candidate => ({
      id: candidate.id,
      name: candidate.name,
      status: candidate.current_status,
      statusAsOf: candidate.status_as_of,
      partyId: candidate.primary_party_id || null,
      page: `${siteUrl}/candidats/${candidate.id}`
    })),
    topics: (compass.questions || []).map(topic => ({
      id: topic.id,
      label: topic.label,
      description: topic.description,
      page: `${siteUrl}/themes/${topic.id}`
    }))
  }, {
    headers: { "cache-control": "public, max-age=300, s-maxage=3600" }
  });
}
