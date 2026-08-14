import Link from "next/link";
import health from "../../research/veille/health.json" with { type: "json" };
import LiveWatchStatus from "../../components/LiveWatchStatus.js";
import { buildCandidateProfile, buildTopicExplorer, getExplorerMeta } from "../../lib/explorer-attribution.js";

const ACTIVE = new Set(["official_candidate","declared_presidential","party_designated","declared_primary","declared_conditional","exploratory"]);
const LABELS = { documented: "documenté", partial: "partiel", party_only: "parti seulement", none: "non documenté" };

export const metadata = {
  title: "Données ouvertes, couverture et méthodologie",
  description: "Auditez la couverture, la fraîcheur, les sources et les limites du corpus open source France 2027 : candidats, partis, attribution, veille, niveaux de preuve et données réutilisables.",
  alternates: { canonical: "/donnees" }
};

function pct(value) { return `${Math.round(value * 1000) / 10} %`; }
function stateCell(level) { return <span className={`coverageState ${level}`}><i />{LABELS[level] || level}</span>; }

export default function DataPage() {
  const meta = getExplorerMeta();
  const active = meta.candidates.filter(candidate => ACTIVE.has(candidate.currentStatus)).sort((a,b)=>a.name.localeCompare(b.name,"fr"));
  const activeIds = new Set(active.map(candidate => candidate.id));
  const profiles = active.map(candidate => buildCandidateProfile(candidate.id));
  const topics = meta.topics.map(topic => {
    const data = buildTopicExplorer(topic.id);
    const covered = data.candidates.filter(row => activeIds.has(row.candidate.id) && ["documented","partial"].includes(row.coverage.level)).length;
    const attributed = data.candidates.filter(row => activeIds.has(row.candidate.id) && row.coverage.partyProgrammeAttributed && !row.coverage.directEvidence.length).length;
    return { ...topic, covered, attributed, parties: data.parties.length };
  });
  const totalCells = profiles.length * meta.topics.length;
  const coveredCells = profiles.reduce((sum, profile) => sum + profile.coverage.filter(item => ["documented","partial"].includes(item.level)).length, 0);
  const directCells = profiles.reduce((sum, profile) => sum + profile.coverage.filter(item => item.directEvidence?.length).length, 0);
  const attributedCells = profiles.reduce((sum, profile) => sum + profile.coverage.filter(item => item.partyProgrammeAttributed && !item.directEvidence?.length).length, 0);
  const partyOnlyCells = profiles.reduce((sum, profile) => sum + profile.coverage.filter(item => item.level === "party_only").length, 0);
  const coverageRatio = totalCells ? coveredCells / totalCells : 0;

  return <main className="seoPage">
    <div className="seoBreadcrumbs"><Link href="/">France 2027</Link><span>›</span><span>Données & méthode</span></div>
    <section className="seoHero"><span className="publicEyebrow">Audit public du corpus</span><h1>Couverture, fraîcheur et limites visibles</h1><p>Un corpus politique fiable doit permettre de voir ce qu’il sait autant que ce qu’il ne sait pas encore. Cette page expose la couverture, la veille et les règles d’attribution qui empêchent de transformer une lacune ou une simple proximité partisane en position politique.</p><div className="seoMetaRow"><span>instantané canonique {meta.snapshotDate}</span><span>source de vérité : Markdown/YAML versionnés</span><span>veille actualisée indépendamment des publications canoniques</span></div></section>

    <section className="seoSection"><div className="seoSectionHeading"><div><span className="publicEyebrow">Indicateurs</span><h2>État actuel du corpus</h2></div><p>La couverture porte sur les candidatures actives ou déclarées et les douze thèmes publics. Elle mesure les preuves attribuables, jamais la qualité politique d’un programme.</p></div><div className="coverageStrip"><div><strong>{meta.counts?.proposals ?? "—"}</strong><span>propositions atomiques indexées</span></div><div><strong>{active.length}</strong><span>candidatures actives ou déclarées</span></div><div><strong>{coveredCells}/{totalCells}</strong><span>cases candidat × thème avec preuve attribuable</span></div><div><strong>{pct(coverageRatio)}</strong><span>couverture attribuable de la matrice active</span></div></div><div className="seoMetaRow"><span>{directCells} cases avec source personnelle</span><span>{attributedCells} cases couvertes via programme de parti officiellement attribué</span><span>{partyOnlyCells} cases avec contexte de parti non attribuable</span><span>{meta.counts?.documents ?? "—"} documents politiques</span></div></section>

    <section className="seoSection"><div className="seoSectionHeading"><div><span className="publicEyebrow">Matrice active</span><h2>Couverture candidat × thème</h2></div><p>Vert : faisceau documentaire solide. Jaune : couverture attribuable mais partielle. Bleu : le parti est documenté sans pouvoir attribuer son programme à cette personnalité. Gris : aucune preuve attribuable structurée.</p></div><div className="coverageMatrix"><table><thead><tr><th>Personnalité</th>{meta.topics.map(topic=><th key={topic.id}>{topic.label}</th>)}</tr></thead><tbody>{profiles.map(profile => <tr key={profile.candidate.id}><td><Link href={`/candidats/${profile.candidate.id}`}>{profile.candidate.name}</Link></td>{profile.coverage.map(item=><td key={item.topicId}>{stateCell(item.level)}</td>)}</tr>)}</tbody></table></div></section>

    <section className="seoSection"><div className="seoSectionHeading"><div><span className="publicEyebrow">Couverture par enjeu</span><h2>Où le corpus est dense — et où il doit encore progresser</h2></div><p>Les numérateurs et pourcentages sont calculés uniquement sur les candidatures actives ou déclarées du même instantané.</p></div><div className="seoCardGrid">{topics.map(topic=><Link className="seoCard" href={`/themes/${topic.id}`} key={topic.id}><strong>{topic.label}</strong><p>{topic.covered} candidature(s) active(s) avec preuve attribuable{topic.attributed ? `, dont ${topic.attributed} via programme de parti officiellement attribué` : ""} · {topic.parties} parti(s) avec éléments indexés.</p><div className="seoMetaRow"><span>{pct(active.length ? topic.covered / active.length : 0)} des candidatures actives</span></div></Link>)}</div></section>

    <section className="seoSection"><div className="seoSectionHeading"><div><span className="publicEyebrow">Chaîne de fraîcheur</span><h2>Veille et promotion canonique</h2></div><p>La collecte peut tourner plus souvent que la publication du site. L’état ci-dessous est relu depuis la route de santé publique, indépendamment du rythme des builds ; en cas d’indisponibilité, la page conserve l’état embarqué lors du dernier déploiement.</p></div><LiveWatchStatus fallback={health} /></section>

    <section className="seoSection"><div className="seoSectionHeading"><div><span className="publicEyebrow">Données ouvertes</span><h2>Réutiliser et auditer le corpus</h2></div><p>Les fichiers Markdown et YAML restent la source de vérité. Les interfaces JSON et autres vues machine-readable servent à la découverte et ne remplacent pas les enregistrements canoniques versionnés.</p></div><div className="openDataPanel"><article><h3>Dépôt canonique open source</h3><p>Registres YAML, documents, propositions atomiques, méthodologie, historique Git et licences.</p><a href="https://github.com/TFourniax/programmes-politiques-france-2027" target="_blank" rel="noreferrer">Ouvrir le dépôt ↗</a></article><article><h3>Manifest public JSON</h3><p>Point d’entrée dérivé pour découvrir l’instantané, les candidats, les règles d’attribution, les thèmes et les URLs publiques.</p><a href="/api/open-data">Ouvrir le manifest →</a></article><article><h3>Accès agents / LLM</h3><p>Fichier de découverte indiquant les routes utiles, les limites de preuve et les chemins canoniques sans demander à un modèle d’inventer la donnée.</p><a href="/llms.txt">Lire llms.txt →</a></article></div></section>

    <section className="seoSection"><div className="seoSectionHeading"><div><span className="publicEyebrow">Règles de lecture</span><h2>Ce que les chiffres ne signifient pas</h2></div></div><p>Une case « non documenté » ne signifie pas qu’une personnalité est opposée au sujet, qu’elle n’a aucune position ou qu’elle n’en aura pas. Une plateforme de parti n’est attribuée à une personnalité que si celle-ci est officiellement désignée par ce parti ; la source reste néanmoins le document du parti. Les niveaux de preuve qualifient la documentation, pas les chances électorales ni la faisabilité de la mesure.</p><div className="methodLinks"><a href="https://github.com/TFourniax/programmes-politiques-france-2027/blob/main/METHODOLOGY.md" target="_blank" rel="noreferrer">Méthodologie ↗</a><a href="https://github.com/TFourniax/programmes-politiques-france-2027/blob/main/NEUTRALITY_CHARTER.md" target="_blank" rel="noreferrer">Charte de neutralité ↗</a><a href="https://github.com/TFourniax/programmes-politiques-france-2027/blob/main/RIGHTS_AND_LICENSES.md" target="_blank" rel="noreferrer">Droits & licences ↗</a></div></section>
  </main>;
}
