import Link from "next/link";
import ChatApp from "./ChatApp.js";
import { getExplorerMeta } from "../lib/explorer-attribution.js";

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
    name: "France 2027 — corpus open source des programmes politiques",
    description: "Corpus ouvert, sourcé, vérifié et versionné des candidatures, programmes, propositions et positions documentées pour l'élection présidentielle française de 2027.",
    url: siteUrl,
    sameAs: "https://github.com/TFourniax/programmes-politiques-france-2027",
    inLanguage: "fr-FR",
    temporalCoverage: "2026/2027",
    isAccessibleForFree: true,
    dateModified: meta.snapshotDate || undefined,
    license: "https://github.com/TFourniax/programmes-politiques-france-2027/blob/main/RIGHTS_AND_LICENSES.md",
    measurementTechnique: "Sources primaires privilégiées, corpus versionné, propositions atomiques, attribution contrôlée et retrieval déterministe sans ajout de faits hors corpus",
    keywords: ["présidentielle 2027", "programmes politiques", "open data", "open source", "comparateur politique", "propositions candidats"],
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
          <Link href="/mises-a-jour">Mises à jour</Link>
          <Link href="/?mode=compare#explorer">Comparer</Link>
          <Link href="/donnees">Données & méthode</Link>
        </nav>
        <a className="publicRepoLink" href="https://github.com/TFourniax/programmes-politiques-france-2027" target="_blank" rel="noreferrer">Code & données ouverts ↗</a>
      </header>

      <section className="publicHero" aria-labelledby="public-hero-title">
        <div className="publicHeroCopy">
          <span className="publicEyebrow">Présidentielle française 2027 · observatoire open source indépendant</span>
          <h1 id="public-hero-title">Les programmes politiques, documentés jusque dans la source.</h1>
          <p>Un corpus public, profond et versionné pour explorer les propositions des candidats et des partis sans dépendre d’une réponse « plausible ». Le moteur restitue les éléments retrouvés dans les documents vérifiés : lorsqu’une information manque, aucun LLM ne l’invente pour remplir le vide.</p>
          <div className="publicHeroActions">
            <a className="primaryAction" href="#explorer">Interroger le corpus</a>
            <Link className="secondaryAction" href="/?mode=compare#explorer">Comparer les programmes</Link>
          </div>
          <div className="publicTrustLine" aria-label="Principes du corpus">
            <span>Sources primaires privilégiées</span>
            <span>Open source & auditable</span>
            <span>Retrieval sans invention</span>
            <span>Historique versionné</span>
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
          <Link href="/donnees">Auditer la couverture, les sources et les limites →</Link>
        </aside>
      </section>

      <section className="publicEditorialGrid" aria-label="Pourquoi ce corpus est différent">
        <article><span>01</span><h2>Des données politiques, pas une opinion de modèle.</h2><p>Les réponses partent du corpus. Le système ne complète pas une proposition avec la mémoire générale d’un modèle et ne transforme jamais un silence documentaire en position politique.</p></article>
        <article><span>02</span><h2>Chaque information garde sa preuve et sa date.</h2><p>Source originale, attribution, statut, version et historique restent attachés aux documents. Un programme de parti n’est attribué à un candidat que lorsqu’il est officiellement désigné par ce parti.</p></article>
        <article><span>03</span><h2>Open source, vérifiable et réutilisable.</h2><p>Le corpus, ses règles, sa méthodologie et les données dérivées sont auditables. L’interface simplifie la lecture ; elle ne cache ni les sources, ni les lacunes, ni les décisions de traitement.</p></article>
      </section>

      <section className="publicSection" aria-labelledby="topics-title">
        <div className="publicSectionHeading"><div><span className="publicEyebrow">Les enjeux</span><h2 id="topics-title">Douze thèmes pour lire la campagne avec la même grille documentaire.</h2></div><Link href="/themes">Tous les thèmes →</Link></div>
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
        <div className="publicSectionHeading"><div><span className="publicEyebrow">Personnalités suivies</span><h2 id="candidates-title">Une fiche sourcée par personnalité, avec une règle d’attribution explicite.</h2><p>Les sources personnelles restent distinctes. Le programme d’un parti n’est attribué à une personnalité que si elle est officiellement désignée par ce parti ; la provenance du document reste toujours visible.</p></div><Link href="/candidats">Toutes les fiches →</Link></div>
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
        <div><span className="publicEyebrow">Confiance par construction</span><h2>Une réponse convaincante ne suffit pas. Elle doit être traçable.</h2></div>
        <p>La chaîne est contrôlable de bout en bout : collecte, vérification de la source, attribution, version, proposition atomique, retrieval, puis présentation. Le moteur déterministe cherche d’abord dans les preuves structurées ; une éventuelle couche de mise en forme ne peut pas ajouter de faits politiques absents des éléments récupérés.</p>
        <div className="methodLinks"><Link href="/donnees">Audit du corpus</Link><Link href="/mises-a-jour">Journal des mises à jour</Link><a href="https://github.com/TFourniax/programmes-politiques-france-2027/blob/main/METHODOLOGY.md" target="_blank" rel="noreferrer">Méthodologie ↗</a><a href="https://github.com/TFourniax/programmes-politiques-france-2027" target="_blank" rel="noreferrer">Code & données ↗</a></div>
      </section>
    </main>

    <section id="explorer" className="embeddedExplorer" aria-label="Explorateur du corpus">
      <div className="embeddedExplorerIntro"><span className="publicEyebrow">Explorateur</span><h2>Posez une question. La réponse doit pouvoir remonter à ses preuves.</h2><p>La recherche libre est un mode d’accès au corpus parmi d’autres. Vous pouvez aussi parcourir les fiches, thèmes, historiques et comparaisons directement indexables.</p></div>
      <ChatApp embedded />
    </section>

    <footer className="publicFooter">
      <div><strong>France 2027 · Observatoire des programmes</strong><p>Corpus open source, sourcé, versionné et sans recommandation de vote.</p></div>
      <nav><Link href="/candidats">Candidats</Link><Link href="/themes">Thèmes</Link><Link href="/mises-a-jour">Mises à jour</Link><Link href="/donnees">Données & méthode</Link><a href="https://github.com/TFourniax/programmes-politiques-france-2027" target="_blank" rel="noreferrer">GitHub ↗</a></nav>
    </footer>
  </>;
}
