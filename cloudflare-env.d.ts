declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    MUSIC_BUCKET: R2Bucket;
    MATCHES: DurableObjectNamespace;
    SOCIAL_PRESENCE: DurableObjectNamespace;
    ASSETS: Fetcher;
  }
}
