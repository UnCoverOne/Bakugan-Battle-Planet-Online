/** Single build-time gate shared by client and server. Do not enable until
 * every legacy admission/invitation/recovery path has been migrated and the
 * production migration and browser/Cloudflare tests have passed. */
export const PERSISTENT_LOBBY_ENABLED = false;
