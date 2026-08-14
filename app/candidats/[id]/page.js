import Link from "next/link";
import { notFound } from "next/navigation";
import { buildCandidateProfile, getExplorerMeta } from "../../../lib/explorer-attribution.js";

const DOCUMENT_STATUS_LABELS = {
  current: "version actuelle",
  amended: "version amendée",
  archived: "document archivé — contexte historique",
  superseded: "document remplacé — contexte historique",
  withdrawn: "document retiré — contexte historique",
  rejected: "document écarté",
  draft: "brouillon",
  historical: "document historique",
  unknown: "statut non renseigné"
};

export function generateStaticParams() {
  return getExplorerMeta().candidates.map((candidate) => ({ id: candidate.id }));
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const candidate = getExplorerMeta().candidates.find((item) => item.id === id);
  if (!candidate) return {};
  return {
    title: `${candidate.name} — Programme, propositions et sources 2027`,
    description: `Fiche sourcée de ${candidate.name} pour la présidentielle 2027 : statut, propositions documentées, programme de parti lorsque son attribution est officielle, sources, historique et limites du corpus.`,
    alternates: { canonical: `/candidats/${candidate.id}` },
    openGraph: {
      title: `${candidate.name} — Programme et positions documentées 2027`,
      description: `Consultez les propositions, sources et l’historique documenté de ${candidate.name} dans le corpus open source France 2027.`,
      url: `/candidats/${candidate.id}`
    }
  };
}

function CoverageState({ item }) {
  const labels = { documented: "documenté", partial: "partiel", party_only: "parti seulement", none: "non documenté" };
  return <span className={`coverageState ${item.level}`}><i />{labels[item.level] || item.level}</span>;
}

function Evidence({ item }) {
  const status = DOCUMENT_STATUS_LABELS[item.documentStatus] || item.documentStatus || "statut non renseigné";
  return <article className="seoEvidence"><div className="seoEvidenceTop"><strong>{item.title}</strong><small>{item.publishedAt || "date non renseignée"} · {status}</small></div>{item.excerpt && <p>{item.excerpt}</p>}<div className="seoEvidenceLinks">{item.githubUrl && <a href={item.githubUrl} target="_blank" rel="noreferrer">Dans le corpus ↗</a>}{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Source originale ↗</a>}</div></article>;
}

export default async function CandidatePage({ params }) {
  const { id } = await params;
  let profile;
  try { profile = buildCandidateProfile(id); } catch { notFound(); }
  const c = profile.candidate;
  const coveredCount = profile.coverage.filter(item => ["documented","partial"].includes(item.level)).length;
  const attributedCount = profile.coverage.filter(item => item.partyProgrammeAttributed).length;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: c.name,
    url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://politique2027.netlify.app"}/candidats/${c.id}`,
    affiliation: c.partyName ? { "@type": "Organization", name: c.partyName } : undefined
  };

  return <main className="seoPage">
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(jsonLd)}} />
    <div className="seoBreadcrumbs"><Link href="/">France 2027</Link><span>›</span><Link href="/candidats">Candidats</Link><span>›</span><span>{c.name}</span></div>
    <section className="seoHero"><span className="publicEyebrow">Fiche personnalité · attribution vérifiable</span><h1>{c.name}</h1><p>{c.statusNote || `Le registre documente actuellement le statut « ${c.statusLabel} » pour ${c.name}. Les sources personnelles restent distinguées des documents de parti. Un programme de parti n'est attribué à une personnalité que lorsqu'elle est officiellement désignée par ce parti.`}</p><div className="seoMetaRow"><span>{c.statusLabel}</span><span>statut au {c.statusAsOf}</span>{c.partyName && <span>{c.partyName}</span>}<span>{coveredCount}/{profile.coverage.length} thèmes couverts</span>{c.partyProgrammeAttributable && <span>{attributedCount} thème(s) avec programme de parti attribuable</span>}</div></section>

    <section className="seoSection"><div className="seoSectionHeading"><div><span className="publicEyebrow">Couverture documentaire</span><h2>Ce que le corpus permet d’examiner</h2></div><p>« Non documenté » décrit uniquement l’état du corpus. Ce n’est jamais une preuve d’absence de position.</p></div><div className="seoCardGrid">{profile.coverage.map(item => <article className="seoCard" key={item.topicId}><strong>{item.topicLabel}</strong><p><CoverageState item={item} /></p><p>{item.directSourceCount} source(s) personnelle(s){item.attributedPartySourceCount ? ` · ${item.attributedPartySourceCount} source(s) de parti officiellement attribuée(s)` : item.partySourceCount ? ` · ${item.partySourceCount} source(s) de parti non attribuée(s)` : ""}</p><div className="seoEvidenceList">{[...(item.directEvidence || []), ...(item.attributedPartyEvidence || [])].slice(0,1).map(evidence=><Evidence item={evidence} key={`${evidence.id}-${evidence.path}`}/>)}</div><Link href={`/themes/${item.topicId}`}>Voir le thème →</Link></article>)}</div></section>

    <section className="seoSection"><div className="seoSectionHeading"><div><span className="publicEyebrow">Sources personnelles</span><h2>Documents et propositions directement rattachés à {c.name}</h2></div><p>Ces éléments sont rattachés directement à la personnalité dans le corpus. Leur statut est affiché pour distinguer l’état courant de l’historique.</p></div>{profile.directDocuments.length ? <div className="seoEvidenceList">{profile.directDocuments.slice(0,12).map(item=><Evidence item={item} key={item.id}/>)}</div> : <p>Aucun document personnel direct n’est encore indexé pour cette personnalité.</p>}</section>

    {profile.partyContextDocuments.length > 0 && <section className="seoSection"><div className="seoSectionHeading"><div><span className="publicEyebrow">{c.partyProgrammeAttributable ? "Programme du parti attribuable" : "Contexte distinct"}</span><h2>Documents de {c.partyName || "son parti principal"}</h2></div><p>{c.partyProgrammeAttributable ? `Ces documents peuvent être attribués à ${c.name}, car cette personnalité est officiellement désignée par ${c.partyName}. Leur provenance reste néanmoins celle du parti et chaque source originale demeure visible.` : `Ces documents sont utiles pour le contexte mais ne sont pas attribués à ${c.name}, faute de désignation officielle par ce parti.`}</p></div><div className="seoEvidenceList">{(c.partyProgrammeAttributable ? profile.attributedPartyDocuments : profile.partyContextDocuments).slice(0,8).map(item=><Evidence item={item} key={`${item.id}-${item.path}`}/>)}</div></section>}

    <section className="seoSection"><div className="seoSectionHeading"><div><span className="publicEyebrow">Explorer davantage</span><h2>Comparer et vérifier</h2></div></div><div className="methodLinks"><Link href={`/?mode=candidates&candidate=${c.id}#explorer`}>Ouvrir la fiche interactive</Link><Link href={`/?mode=compare&c=${c.id}#explorer`}>Ajouter à une comparaison</Link>{c.sourceUrl && <a href={c.sourceUrl} target="_blank" rel="noreferrer">Source du statut ↗</a>}</div></section>
  </main>;
}
