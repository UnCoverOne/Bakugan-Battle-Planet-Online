declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    MATCHES: DurableObjectNamespace;
    ASSETS: Fetcher;
  }
}
