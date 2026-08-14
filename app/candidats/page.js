import Link from "next/link";
import { getExplorerMeta } from "../../lib/explorer.js";

const ACTIVE = new Set(["official_candidate","declared_presidential","party_designated","declared_primary","declared_conditional","exploratory"]);

export const metadata = {
  title: "Candidats et personnalités suivies — Présidentielle 2027",
  description: "Consultez les fiches sourcées des candidats et personnalités suivies pour la présidentielle 2027 : statut, positions directement documentées, contexte de parti séparé et historique.",
  alternates: { canonical: "/candidats" }
};

function CandidateCard({ candidate }) {
  return <Link className="seoCard" href={`/candidats/${candidate.id}`}>
    <strong>{candidate.name}</strong>
    <p>{candidate.statusLabel}{candidate.partyName ? ` · ${candidate.partyName}` : ""}</p>
    <div className="seoMetaRow"><span>statut au {candidate.statusAsOf}</span>{candidate.statusConfidence && <span>preuve {candidate.statusConfidence}</span>}</div>
  </Link>;
}

export default function CandidatesPage() {
  const meta = getExplorerMeta();
  const active = meta.candidates.filter((candidate) => ACTIVE.has(candidate.currentStatus)).sort((a,b)=>a.name.localeCompare(b.name,"fr"));
  const other = meta.candidates.filter((candidate) => !ACTIVE.has(candidate.currentStatus)).sort((a,b)=>a.name.localeCompare(b.name,"fr"));
  return <main className="seoPage">
    <div className="seoBreadcrumbs"><Link href="/">France 2027</Link><span>›</span><span>Candidats</span></div>
    <section className="seoHero"><span className="publicEyebrow">Présidentielle 2027</span><h1>Candidats et personnalités suivies</h1><p>Le registre distingue une candidature déclarée, une désignation de parti, une primaire, une démarche exploratoire et le statut de candidat officiel. Ce dernier n’est utilisé qu’au sens de la liste publiée par le Conseil constitutionnel.</p><div className="seoMetaRow"><span>{active.length} candidatures actives ou déclarées suivies</span><span>{meta.candidates.length} personnalités dans le registre</span><span>instantané {meta.snapshotDate}</span></div></section>
    <section className="seoSection"><div className="seoSectionHeading"><div><span className="publicEyebrow">État courant</span><h2>Candidatures actives ou déclarées</h2></div><p>L’ordre est alphabétique. Il ne reflète ni une intention de vote, ni une probabilité de candidature, ni une importance politique.</p></div><div className="seoCardGrid">{active.map(candidate=><CandidateCard candidate={candidate} key={candidate.id}/>)}</div></section>
    {other.length > 0 && <section className="seoSection"><div className="seoSectionHeading"><div><span className="publicEyebrow">Registre complet</span><h2>Autres personnalités suivies</h2></div><p>Personnalités potentielles, retirées, non candidates ou dont le statut est conservé pour la traçabilité historique.</p></div><div className="seoCardGrid">{other.map(candidate=><CandidateCard candidate={candidate} key={candidate.id}/>)}</div></section>}
  </main>;
}
