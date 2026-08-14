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
    default: "France 2027 — Programmes, candidats & comparateur sourcé",
    template: "%s · France 2027"
  },
  description: "Observatoire public, sourcé et versionné des programmes, propositions et positions documentées pour la présidentielle française de 2027. Comparez les personnalités, les thèmes, l’historique et les sources sans recommandation de vote.",
  keywords: [
    "présidentielle 2027", "programmes politiques 2027", "candidats 2027", "comparateur programmes",
    "propositions politiques", "élection présidentielle France", "programmes candidats", "corpus politique"
  ],
  applicationName: "France 2027 — Observatoire des programmes",
  category: "politique",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: "/",
    siteName: "France 2027 — Observatoire des programmes",
    title: "France 2027 — Programmes, candidats & comparateur sourcé",
    description: "Un corpus ouvert, sourcé et versionné pour explorer les programmes politiques de la présidentielle 2027 jusque dans les documents d’origine."
  },
  twitter: {
    card: "summary",
    title: "France 2027 — Observatoire des programmes",
    description: "Programmes, propositions, candidats, historique et sources vérifiables pour la présidentielle française de 2027."
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
