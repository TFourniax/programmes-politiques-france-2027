/** @type {import('next').NextConfig} */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join('; ');

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" }
];

const dedicatedFallbackKey = String(process.env.LLM_FALLBACK_API_KEY || process.env.OPENAI_API_KEY || "").trim();
const fallbackEnabled = process.env.LLM_RETRIEVAL_FALLBACK_ENABLED !== "false" && Boolean(dedicatedFallbackKey);

const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // COMMIT_REF exists only during Netlify's build. Embed the non-secret SHA so
  // the Deploy Preview smoke test can prove it is exercising the exact PR head,
  // rather than a healthy-but-stale preview from the previous commit.
  //
  // The V1 LLM_API_KEY is deliberately not enough to enable the V2 semantic
  // fallback: it may belong to a legacy/retired provider. A dedicated valid key
  // is required so a stale secret cannot add latency or repeated 401s in prod.
  env: {
    DEPLOY_COMMIT_REF: process.env.COMMIT_REF || process.env.GITHUB_SHA || "",
    LLM_RETRIEVAL_FALLBACK_ENABLED: fallbackEnabled ? "true" : "false"
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;