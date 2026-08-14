import Link from "next/link";
import { getExplorerMeta } from "../../lib/explorer.js";

export const metadata = {
  title: "Thèmes des programmes politiques — Présidentielle 2027",
  description: "Explorez les programmes de la présidentielle 2027 par thème : pouvoir d’achat, retraites, fiscalité, immigration, défense, Europe, écologie, institutions, services publics, sécurité, économie, numérique et IA.",
  alternates: { canonical: "/themes" }
};

export default function TopicsPage() {
  const meta = getExplorerMeta();
  return <main className="seoPage">
    <div className="seoBreadcrumbs"><Link href="/">France 2027</Link><span>›</span><span>Thèmes</span></div>
    <section className="seoHero"><span className="publicEyebrow">Programmes par enjeu</span><h1>Douze thèmes pour explorer les propositions documentées</h1><p>Chaque page thématique rassemble les éléments actuellement présents dans le corpus, distingue les sources directement rattachées aux personnalités du contexte de parti et rend visibles les lacunes de couverture.</p><div className="seoMetaRow"><span>{meta.topics.length} thèmes publics</span><span>{meta.counts?.proposals ?? "—"} propositions atomiques</span><span>instantané {meta.snapshotDate}</span></div></section>
    <section className="seoSection"><div className="seoCardGrid">{meta.topics.map(topic => <Link className="seoCard" href={`/themes/${topic.id}`} key={topic.id}><strong>{topic.label}</strong><p>{topic.description}</p><div className="seoMetaRow"><span>positions documentées</span><span>sources vérifiables</span></div></Link>)}</div></section>
  </main>;
}
