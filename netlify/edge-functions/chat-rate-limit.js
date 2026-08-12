export default async () => undefined;

export const config = {
  path: "/api/chat",
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ["ip", "domain"]
  }
};
