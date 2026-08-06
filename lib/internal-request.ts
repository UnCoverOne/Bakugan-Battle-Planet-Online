const MATCH_COORDINATOR_HEADER = "x-bbp-internal-match-coordinator";
const ORIGINAL_URL_HEADER = "x-bbp-original-url";
const INTERNAL_COORDINATOR_MARKER = "worker-boundary-v1";

/**
 * Public requests pass through worker/index.ts, which removes every internal
 * header before routing. Only the MatchRoom Durable Object adds this marker
 * after that boundary, so the application route never treats a client-supplied
 * header as proof of coordination.
 */
export function stripInternalMatchHeaders(headers: Headers) {
  headers.delete(MATCH_COORDINATOR_HEADER);
  headers.delete(ORIGINAL_URL_HEADER);
}

export function markInternalMatchRequest(headers: Headers, originalUrl: string) {
  headers.set(MATCH_COORDINATOR_HEADER, INTERNAL_COORDINATOR_MARKER);
  headers.set(ORIGINAL_URL_HEADER, originalUrl);
}

export function isInternalMatchRequest(request: Request) {
  return request.headers.get(MATCH_COORDINATOR_HEADER) === INTERNAL_COORDINATOR_MARKER;
}

export function internalOriginalUrl(request: Request) {
  return isInternalMatchRequest(request)
    ? request.headers.get(ORIGINAL_URL_HEADER)
    : null;
}
