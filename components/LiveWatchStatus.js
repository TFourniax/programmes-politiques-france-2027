"use client";

import { useEffect, useState } from "react";

function formatInstant(value) {
  if (!value) return "inconnue";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function LiveWatchStatus({ fallback = {} }) {
  const [watch, setWatch] = useState(fallback);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((payload) => {
        if (cancelled || !payload?.watch) return;
        setWatch(payload.watch);
        setLive(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const status = watch.status || "unknown";
  const lastCollection = watch.lastCollectionSuccessAt || watch.last_collection_success_at || watch.generatedAt || watch.generated_at || null;
  const pending = watch.pendingWork ?? watch.pending_work ?? 0;
  const actionable = watch.actionablePendingWork ?? watch.actionable_pending_work ?? pending;
  const failures = watch.persistentOfficialSourceFailures ?? watch.persistent_official_source_failures ?? 0;
  const warnings = watch.warnings || [];

  return <div className="liveWatchBlock" aria-live="polite">
    <div className="seoMetaRow">
      <span>veille : {status}</span>
      <span>dernière collecte {formatInstant(lastCollection)}</span>
      <span>{live ? "état live via /api/health" : "état embarqué au dernier build"}</span>
    </div>
    <div className="coverageStrip">
      <div><strong>{status}</strong><span>état de la veille</span></div>
      <div><strong>{pending}</strong><span>éléments en attente</span></div>
      <div><strong>{actionable}</strong><span>travail actionnable</span></div>
      <div><strong>{failures}</strong><span>échecs persistants de sources officielles</span></div>
    </div>
    {Array.isArray(warnings) && warnings.length > 0 && <div className="seoMetaRow">{warnings.slice(0, 6).map((warning, index) => <span key={`${warning}-${index}`}>{warning}</span>)}</div>}
  </div>;
}
