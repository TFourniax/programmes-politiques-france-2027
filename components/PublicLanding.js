import Link from "next/link";
import ChatApp from "./ChatApp.js";
import { getExplorerMeta } from "../lib/explorer.js";

const ACTIVE_STATUSES = new Set([
  "official_candidate",
  "declared_presidential",
  "party_designated",
  "declared_primary",
  "declared_conditional",
  "exploratory"
]);

function formatDate(value) {
  if (!value) return "date en cours de vérification";
  try {
    return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
  } catch {
    return value;
  }
}

function DatasetJsonLd({ meta }) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://politique2027.netlify.app";
  const data = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "Programmes politiques — France 2027",
    description: "Corpus ouvert, sourcé et versionné des candidatures, programmes, propositions et positions documentées pour l'élection présidentielle française de 2027.",
    url: siteUrl,
    inLanguage: "fr-FR",
    temporalCoverage: "2026/2027",
    isAccessibleForFree: true,
    dateModified: meta.snapshotDate || undefined,
    license: "https://creativecommons.org/licenses/by/4.0/",
    distribution: [{
      "@type": "DataDownload",
      encodingFormat: "text/markdown",
      contentUrl: "https://github.com/TFourniax/programmes-politiques-france-2027"
    }]
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

export default function PublicLanding() {
  const meta = getExplorerMeta();
  const counts = meta.counts || {};
  const activeCandidates = meta.candidates
    .filter((candidate) => ACTIVE_STATUSES.has(candidate.currentStatus))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const topics = meta.topics || [];

  return <>
    <DatasetJsonLd meta={meta} />
    <main className="publicHome">
      <header className="publicHeader">
        <Link className="publicBrand" href="/" aria-label="France 2027 — accueil">
          <span className="publicBrandMark">27</span>
          <span><strong>France 2027</strong><small>Observatoire des programmes</small></span>
        </Link>
        <nav className="publicNav" aria-label="Navigation principale">
          <Link href="/candidats">Candidats</Link>
          <Link href="/themes">Thèmes</Link>
          <Link href="/?mode=compare#explorer">Comparer</Link>
          <Link href="/donnees">Données & méthode</Link>
        </nav>
        <a className="publicRepoLink" href="https://github.com/TFourniax/programmes-politiques-france-2027" target="_blank" rel="noreferrer">Dépôt ouvert ↗</a>
      </header>

      <section className="publicHero" aria-labelledby="public-hero-title">
        <div className="publicHeroCopy">
          <span className="publicEyebrow">Présidentielle française 2027 · corpus public indépendant</span>
          <h1 id="public-hero-title">Les programmes politiques, vérifiables jusque dans la source.</h1>
          <p>Explorez les propositions, comparez les positions documentées et retrouvez leur historique. Chaque information renvoie au document qui la soutient ; les lacunes restent visibles et les anciennes versions ne sont jamais présentées comme actuelles.</p>
          <div className="publicHeroActions">
            <a className="primaryAction" href="#explorer">Explorer le corpus</a>
            <Link className="secondaryAction" href="/?mode=compare#explorer">Comparer des personnalités</Link>
          </div>
          <div className="publicTrustLine" aria-label="Principes du corpus">
            <span>Sources primaires privilégiées</span>
            <span>Historique versionné</span>
            <span>Parti ≠ personnalité</span>
            <span>Aucune recommandation de vote</span>
          </div>
        </div>
        <aside className="publicPulse" aria-label="État du corpus">
          <div className="pulseTop"><span className="liveDot" />Instantané canonique</div>
          <strong>{formatDate(meta.snapshotDate)}</strong>
          <div className="pulseMetrics">
            <div><b>{counts.proposals ?? "—"}</b><span>propositions atomiques</span></div>
            <div><b>{counts.documents ?? "—"}</b><span>documents politiques</span></div>
            <div><b>{activeCandidates.length}</b><span>candidatures actives ou déclarées suivies</span></div>
            <div><b>{topics.length}</b><span>grands thèmes publics</span></div>
          </div>
          <Link href="/donnees">Voir la couverture, la fraîcheur et les limites →</Link>
        </aside>
      </section>

      <section className="publicEditorialGrid" aria-label="Pourquoi ce corpus est différent">
        <article><span>01</span><h2>Une donnée politique, pas une opinion sur la politique.</h2><p>Le moteur restitue ce qui est documenté. Il ne classe pas les programmes, ne déduit pas une position à partir d’un silence et n’utilise pas la mémoire générale d’un modèle pour compléter les trous.</p></article>
        <article><span>02</span><h2>Le temps fait partie de la donnée.</h2><p>Une proposition remplacée, amendée ou retirée reste consultable dans l’historique sans contaminer l’état courant. La date et le niveau de preuve restent attachés à chaque élément.</p></article>
        <article><span>03</span><h2>La profondeur est vérifiable.</h2><p>Les propositions atomiques, documents sources, niveaux de confiance et liens d’origine sont ouverts. L’interface simplifie la lecture sans rendre le corpus opaque.</p></article>
      </section>

      <section className="publicSection" aria-labelledby="topics-title">
        <div className="publicSectionHeading"><div><span className="publicEyebrow">Les enjeux</span><h2 id="topics-title">Douze thèmes pour lire la campagne sans angle mort structurel.</h2></div><Link href="/themes">Tous les thèmes →</Link></div>
        <div className="publicTopicGrid">
          {topics.map((topic, index) => <Link href={`/themes/${topic.id}`} className="publicTopicCard" key={topic.id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{topic.label}</strong>
            <p>{topic.description}</p>
            <b>Explorer →</b>
          </Link>)}
        </div>
      </section>

      <section className="publicSection candidateIndexPreview" aria-labelledby="candidates-title">
        <div className="publicSectionHeading"><div><span className="publicEyebrow">Personnalités suivies</span><h2 id="candidates-title">Une fiche sourcée par personnalité, sans lui attribuer automatiquement le programme de son parti.</h2></div><Link href="/candidats">Toutes les fiches →</Link></div>
        <div className="candidateNameGrid">
          {activeCandidates.slice(0, 18).map((candidate) => <Link href={`/candidats/${candidate.id}`} key={candidate.id}>
            <span className="candidateMiniDot" style={{ "--candidate-color": candidate.partyColor || "#748196" }} />
            <span><strong>{candidate.name}</strong><small>{candidate.statusLabel}</small></span>
            <b>→</b>
          </Link>)}
        </div>
        {activeCandidates.length > 18 && <p className="candidatePreviewNote">La liste publique complète contient {activeCandidates.length} candidatures actives ou déclarées suivies à cet instantané, ainsi que les personnalités retirées ou non candidates dans l’historique.</p>}
      </section>

      <section className="publicMethodBand">
        <div><span className="publicEyebrow">Confiance par construction</span><h2>Quand le corpus ne sait pas, il le dit.</h2></div>
        <p>La qualité du projet ne repose pas sur une réponse qui paraît convaincante. Elle repose sur une chaîne contrôlable : collecte, source, attribution, version, proposition atomique, retrieval, puis présentation. Une case vide signifie « non encore documenté ici », jamais « position inexistante ».</p>
        <div className="methodLinks"><Link href="/donnees">Audit du corpus</Link><a href="https://github.com/TFourniax/programmes-politiques-france-2027/blob/main/METHODOLOGY.md" target="_blank" rel="noreferrer">Méthodologie ↗</a></div>
      </section>
    </main>

    <section id="explorer" className="embeddedExplorer" aria-label="Explorateur du corpus">
      <div className="embeddedExplorerIntro"><span className="publicEyebrow">Explorateur</span><h2>Rechercher, comparer ou remonter aux sources.</h2><p>La recherche libre est un mode d’accès au corpus parmi d’autres. Vous pouvez aussi parcourir directement les fiches, thèmes, historiques et comparaisons.</p></div>
      <ChatApp embedded />
    </section>

    <footer className="publicFooter">
      <div><strong>France 2027 · Observatoire des programmes</strong><p>Corpus ouvert, versionné et sans recommandation de vote.</p></div>
      <nav><Link href="/candidats">Candidats</Link><Link href="/themes">Thèmes</Link><Link href="/donnees">Données & méthode</Link><a href="https://github.com/TFourniax/programmes-politiques-france-2027" target="_blank" rel="noreferrer">GitHub ↗</a></nav>
    </footer>
  </>;
}
