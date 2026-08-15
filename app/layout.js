import "./globals.css";
import "./explorer.css";
import "./quiz-review.css";
import "./product-hardening.css";
import "./deep-dive.css";
import "./public-home.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://politique2027.netlify.app";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "France 2027 — Programmes politiques, candidats & comparateur sourcé",
    template: "%s · France 2027"
  },
  description: "Observatoire open source des programmes politiques de la présidentielle 2027 : propositions vérifiées, sources primaires, candidats, partis, comparateur, historique versionné et réponses strictement fondées sur le corpus.",
  keywords: [
    "présidentielle 2027", "programmes politiques 2027", "candidats 2027", "comparateur programmes 2027",
    "propositions politiques", "programme candidat 2027", "élection présidentielle France", "programmes candidats",
    "open data politique", "open source politique", "comparateur politique sourcé", "corpus politique vérifié"
  ],
  applicationName: "France 2027 — Observatoire open source des programmes",
  category: "politique",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: "/",
    siteName: "France 2027 — Observatoire des programmes",
    title: "France 2027 — Programmes politiques, candidats & comparateur sourcé",
    description: "Un corpus open source, profond, sourcé et versionné pour explorer et comparer les programmes politiques de la présidentielle 2027 jusque dans les documents d’origine."
  },
  twitter: {
    card: "summary",
    title: "France 2027 — Observatoire open source des programmes",
    description: "Programmes, propositions, candidats, historique et sources vérifiables pour la présidentielle française de 2027 — sans invention hors corpus."
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large", "max-video-preview": -1 }
  }
};

export default function RootLayout({ children }) {
  return <html lang="fr"><body>{children}</body></html>;
}
