export default function robots() {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://politique2027.netlify.app").replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/chat"] }],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl
  };
}
