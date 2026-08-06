const MATCH_COORDINATOR_HEADER = "x-bbp-internal-match-coordinator";
const ORIGINAL_URL_HEADER = "x-bbp-original-url";

const coordinatorToken = (() => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
})();

function constantTimeEqual(left: string, right: string) {
  const maximum = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < maximum; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export function stripInternalMatchHeaders(headers: Headers) {
  headers.delete(MATCH_COORDINATOR_HEADER);
  headers.delete(ORIGINAL_URL_HEADER);
}

export function markInternalMatchRequest(headers: Headers, originalUrl: string) {
  headers.set(MATCH_COORDINATOR_HEADER, coordinatorToken);
  headers.set(ORIGINAL_URL_HEADER, originalUrl);
}

export function isInternalMatchRequest(request: Request) {
  const supplied = request.headers.get(MATCH_COORDINATOR_HEADER) ?? "";
  return Boolean(supplied) && constantTimeEqual(supplied, coordinatorToken);
}

export function internalOriginalUrl(request: Request) {
  return isInternalMatchRequest(request)
    ? request.headers.get(ORIGINAL_URL_HEADER)
    : null;
}
