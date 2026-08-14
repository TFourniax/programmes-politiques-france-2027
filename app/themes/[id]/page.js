import Link from "next/link";
import { notFound } from "next/navigation";
import { buildTopicExplorer, getExplorerMeta } from "../../../lib/explorer-attribution.js";

export function generateStaticParams() {
  return getExplorerMeta().topics.map((topic) => ({ id: topic.id }));
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const topic = getExplorerMeta().topics.find((item) => item.id === id);
  if (!topic) return {};
  return {
    title: `${topic.label} — Programmes et propositions 2027`,
    description: `Comparez les positions et propositions documentées sur ${topic.label.toLowerCase()} pour la présidentielle 2027 : sources personnelles, programmes de parti officiellement attribuables, preuves et limites du corpus.`,
    alternates: { canonical: `/themes/${topic.id}` },
    openGraph: {
      title: `${topic.label} — Présidentielle 2027`,
      description: `Positions documentées, propositions et sources vérifiables sur ${topic.label.toLowerCase()} dans le corpus open source France 2027.`,
      url: `/themes/${topic.id}`
    }
  };
}

function Evidence({ item }) {
  return <article className="seoEvidence"><div className="seoEvidenceTop"><strong>{item.title}</strong><small>{item.publishedAt || "date non renseignée"}</small></div>{item.excerpt && <p>{item.excerpt}</p>}<div className="seoEvidenceLinks">{item.githubUrl && <a href={item.githubUrl} target="_blank" rel="noreferrer">Dans le corpus ↗</a>}{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Source originale ↗</a>}</div></article>;
}

export default async function TopicPage({ params }) {
  const { id } = await params;
  let data;
  try { data = buildTopicExplorer(id); } catch { notFound(); }
  const withCoverage = data.candidates.filter(row => ["documented","partial"].includes(row.coverage.level));
  const attributed = data.candidates.filter(row => row.coverage.partyProgrammeAttributed && !row.coverage.directEvidence.length);
  const partyOnly = data.candidates.filter(row => row.coverage.level === "party_only");
  const missing = data.candidates.filter(row => row.coverage.level === "none");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${data.topic.label} — propositions politiques France 2027`,
    description: data.topic.description,
    url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://politique2027.netlify.app"}/themes/${data.topic.id}`,
    dateModified: data.snapshotDate,
    inLanguage: "fr-FR",
    isAccessibleForFree: true
  };

  return <main className="seoPage">
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(jsonLd)}} />
    <div className="seoBreadcrumbs"><Link href="/">France 2027</Link><span>›</span><Link href="/themes">Thèmes</Link><span>›</span><span>{data.topic.label}</span></div>
    <section className="seoHero"><span className="publicEyebrow">Thème des programmes 2027</span><h1>{data.topic.label}</h1><p>{data.topic.description} Cette page décrit la couverture documentaire du corpus : elle ne classe ni les candidats ni la qualité politique de leurs propositions.</p><div className="seoMetaRow"><span>{withCoverage.length} personnalités avec preuve attribuable</span>{attributed.length > 0 && <span>{attributed.length} via programme de parti officiellement attribué</span>}<span>{partyOnly.length} avec contexte de parti seulement</span><span>{missing.length} non documentées</span><span>instantané {data.snapshotDate}</span></div></section>

    <section className="seoSection"><div className="seoSectionHeading"><div><span className="publicEyebrow">Positions attribuables</span><h2>Personnalités avec éléments documentés</h2></div><p>L’ordre suit la force de couverture documentaire, puis l’ordre alphabétique. Il ne constitue pas un classement politique.</p></div>{withCoverage.length ? <div className="seoCardGrid">{withCoverage.map(row => { const evidence = [...(row.coverage.directEvidence || []), ...(row.coverage.attributedPartyEvidence || [])]; return <article className="seoCard" key={row.candidate.id}><strong>{row.candidate.name}</strong><p>{row.candidate.statusLabel}{row.candidate.partyName ? ` · ${row.candidate.partyName}` : ""}</p><div className="seoMetaRow"><span>{row.coverage.level === "documented" ? "couverture documentée" : "couverture partielle"}</span><span>{row.coverage.directSourceCount} source(s) personnelle(s)</span>{row.coverage.attributedPartySourceCount > 0 && <span>{row.coverage.attributedPartySourceCount} source(s) de parti officiellement attribuée(s)</span>}</div><div className="seoEvidenceList">{evidence.slice(0,2).map(item=><Evidence item={item} key={`${item.id}-${item.path}`}/>)}</div><Link href={`/candidats/${row.candidate.id}`}>Fiche complète →</Link></article>; })}</div> : <p>Aucune source attribuable n’est encore structurée sur ce thème dans l’instantané actuel.</p>}</section>

    {data.parties.length > 0 && <section className="seoSection"><div className="seoSectionHeading"><div><span className="publicEyebrow">Plateformes de partis</span><h2>Documents de parti sur ce thème</h2></div><p>La provenance reste toujours le parti. Le programme n’est transféré à une personnalité que si celle-ci est officiellement désignée pour le porter.</p></div><div className="seoCardGrid">{data.parties.slice(0,18).map(row => <article className="seoCard" key={row.party.id}><strong>{row.party.name}</strong><p>{row.evidence.length} document(s) ou proposition(s) pertinent(s)</p><div className="seoEvidenceList">{row.evidence.slice(0,1).map(item=><Evidence item={item} key={item.id}/>)}</div></article>)}</div></section>}

    <section className="seoSection"><div className="seoSectionHeading"><div><span className="publicEyebrow">Lecture prudente</span><h2>Lacunes visibles</h2></div><p>Une absence de source attribuable dans ce corpus ne démontre jamais qu’une personnalité n’a pas de position sur {data.topic.label.toLowerCase()}.</p></div><div className="seoMetaRow">{missing.slice(0,30).map(row=><span key={row.candidate.id}>{row.candidate.name} · non documenté</span>)}</div></section>

    <section className="seoSection"><div className="methodLinks"><Link href={`/?mode=topics&topic=${data.topic.id}#explorer`}>Ouvrir l’explorateur interactif</Link><Link href={`/?mode=compare&topic=${data.topic.id}#explorer`}>Comparer sur ce thème</Link></div></section>
  </main>;
}
