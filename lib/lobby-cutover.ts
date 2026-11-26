/** Single build-time gate shared by client and server. Do not enable until
 * every legacy admission/invitation/recovery path has been migrated and the
 * production migration and browser/Cloudflare tests have passed. */
export const PERSISTENT_LOBBY_ENABLED = false;

/** Drain deployment: stop new legacy rooms while existing rooms can finish.
 * Do not enable until an operational drain and backup plan is approved. */
export const LEGACY_LOBBY_CREATION_CLOSED = false;
