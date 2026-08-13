declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    MATCHES: DurableObjectNamespace;
    SOCIAL_PRESENCE: DurableObjectNamespace;
    ASSETS: Fetcher;
  }
}
