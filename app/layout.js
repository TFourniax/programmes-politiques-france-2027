import "./globals.css";
import "./explorer.css";
import "./quiz-review.css";
import "./product-hardening.css";
import "./deep-dive.css";

export const metadata = {
  title: "France 2027 — Programmes, candidats & comparateur sourcé",
  description: "Explorez un corpus ouvert, sourcé et versionné des programmes, propositions et positions documentées pour la présidentielle française de 2027. Comparez les personnalités, les thèmes, les anciennes versions et les sources sans recommandation de vote."
};

export default function RootLayout({ children }) {
  return <html lang="fr"><body>{children}</body></html>;
}
