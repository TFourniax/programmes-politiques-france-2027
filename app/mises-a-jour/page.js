import Link from "next/link";
import { buildRecentDocumentFeed } from "../../lib/updates.js";

export const metadata = {
  title: "Mises à jour du corpus",
  description: "Les documents politiques actuels les plus récemment datés dans le corpus France 2027, avec acteur, statut et source d'origine.",
  alternates: { canonical: "/mises-a-jour" },
  openGraph: {
    title: "Mises à jour du corpus · France 2027",
    description: "Suivre les nouveaux documents et changements documentés du corpus présidentiel 2027.",
    url: "/mises-a-jour"
  }
};

function formatDate(value) {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

const TIER = {
  tier_1_primary_official: "source primaire officielle",
  tier_2_primary_statement: "déclaration primaire",
  tier_3_reliable_secondary: "source secondaire fiable",
  tier_4_discovery_only: "source de découverte"
};

export default function UpdatesPage() {
  const updates = buildRecentDocumentFeed(100);
  return <main className="seoPage">
    <nav className="seoBreadcrumbs"><Link href="/">France 2027</Link><span>›</span><span>Mises à jour</span></nav>
    <header className="seoHero">
      <span className="publicEyebrow">Journal documentaire</span>
      <h1>Mises à jour du corpus</h1>
      <p>Les documents actuels les plus récemment datés dans le corpus. Cette page expose la fraîcheur documentaire ; elle ne transforme pas chaque nouvelle publication en « changement de position ». Un revirement ou un remplacement n'est qualifié comme tel que lorsqu'il est explicitement documenté dans le canon.</p>
      <div className="seoMetaRow"><span>{updates.length} documents récents affichés au maximum</span><span>versions actuelles uniquement</span><span>sources traçables</span></div>
    </header>

    <section className="seoSection">
      <div className="seoSectionHeading"><div><h2>Derniers documents datés</h2><p>Les entrées sont triées par date de publication connue. Une page sans date suffisamment précise n'est pas artificiellement placée dans la chronologie.</p></div></div>
      <div className="seoEvidenceList">
        {updates.map((item) => <article className="seoEvidence" key={item.path}>
          <div className="seoEvidenceTop"><strong>{item.title}</strong><small>{formatDate(item.publishedAt)} · {item.documentStatus === "amended" ? "version amendée" : "version actuelle"}</small></div>
          <p><b>{item.entityLabel}</b>{item.sourceTier ? ` · ${TIER[item.sourceTier] || item.sourceTier}` : ""}</p>
          {item.excerpt && <p>{item.excerpt}</p>}
          <div className="seoEvidenceLinks">
            {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Source d'origine ↗</a>}
            <a href={`https://github.com/TFourniax/programmes-politiques-france-2027/blob/main/${item.path}`} target="_blank" rel="noreferrer">Version canonique ↗</a>
            {item.entityType === "candidate" && <Link href={`/candidats/${item.entityId}`}>Fiche personnalité →</Link>}
          </div>
        </article>)}
      </div>
    </section>

    <section className="seoSection">
      <h2>Lire correctement cette chronologie</h2>
      <p>« Nouveau dans le corpus » ne signifie pas nécessairement « nouvelle position politique ». Le document peut formaliser une orientation plus ancienne. À l'inverse, lorsqu'une source remplace explicitement une autre version, les liens de version du corpus permettent de conserver les deux états sans présenter l'ancien comme actuel.</p>
      <div className="seoEvidenceLinks"><Link href="/donnees">Couverture & méthode →</Link><a href="https://github.com/TFourniax/programmes-politiques-france-2027/blob/main/METHODOLOGY.md" target="_blank" rel="noreferrer">Méthodologie complète ↗</a></div>
    </section>
  </main>;
}
