import { getExplorerMeta } from "../lib/explorer.js";

export default function sitemap() {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://politique2027.netlify.app").replace(/\/$/, "");
  const meta = getExplorerMeta();
  const lastModified = meta.snapshotDate ? new Date(`${meta.snapshotDate}T12:00:00Z`) : new Date();
  const fixed = [
    ["", 1, "daily"],
    ["/candidats", 0.9, "daily"],
    ["/themes", 0.9, "daily"],
    ["/donnees", 0.85, "daily"]
  ].map(([path, priority, changeFrequency]) => ({ url: `${siteUrl}${path}`, lastModified, changeFrequency, priority }));
  const candidates = meta.candidates.map(candidate => ({
    url: `${siteUrl}/candidats/${candidate.id}`,
    lastModified: candidate.statusAsOf ? new Date(`${candidate.statusAsOf}T12:00:00Z`) : lastModified,
    changeFrequency: "daily",
    priority: 0.8
  }));
  const topics = meta.topics.map(topic => ({
    url: `${siteUrl}/themes/${topic.id}`,
    lastModified,
    changeFrequency: "daily",
    priority: 0.8
  }));
  return [...fixed, ...candidates, ...topics];
}
