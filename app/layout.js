import "./globals.css";

export const metadata = {
  title: "Programmes politiques France 2027 — Corpus & Chat",
  description: "Interrogez un corpus ouvert, sourcé et versionné des programmes et positions politiques de la présidentielle française de 2027."
};

export default function RootLayout({ children }) {
  return <html lang="fr"><body>{children}</body></html>;
}
