import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SECURITY_HEADERS, withSecurityHeaders } from "../lib/security-headers.ts";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("production HTML responses retain security headers without importing a workerd bundle in Node", () => {
  // The production worker imports this header implementation. The build script
  // separately validates the Cloudflare-native Worker artifact with Wrangler.
  const worker = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  const built = readFileSync(new URL("../dist/server/index.js", import.meta.url), "utf8");
  assert.match(worker, /import \{ withSecurityHeaders \} from "\.\.\/lib\/security-headers"/);
  assert.doesNotMatch(built, developmentPreviewMeta);

  const response = withSecurityHeaders(new Response("<!doctype html><html><head></head><body></body></html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /img-src 'self' data: blob:/);
  assert.deepEqual(
    [...csp.matchAll(/https:\/\/[^\s;]+/g)].map(([origin]) => origin).sort(),
    ["https://fonts.googleapis.com", "https://fonts.gstatic.com"],
  );
  assert.equal(SECURITY_HEADERS["x-frame-options"], "DENY");
});
