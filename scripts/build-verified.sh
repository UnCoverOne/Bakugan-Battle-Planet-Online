#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  # Run the build script through bash after sites-env prepares the writable
  # Cloudflare build environment. Do not execute $0 directly because GitHub's
  # contents API may preserve this file without the executable bit.
  exec bash "${script_dir}/sites-env.sh" -- bash "$0" "$@"
fi

# Cloudflare's automatic dependency-install step may create this cache inside
# the repository before our build command runs. When Pages later validates the
# project root as its asset directory, large npm cache blobs are mistaken for
# deployable files and hit the 25 MiB asset limit. The build only needs
# node_modules at this point, so remove the legacy in-repository runtime cache
# before building and again on exit in case another tool recreates it.
cleanup_repository_runtime() {
  local legacy_runtime="${SITES_PROJECT_ROOT}/.sites-runtime"
  if [[ -e "${legacy_runtime}" || -L "${legacy_runtime}" ]]; then
    rm -rf -- "${legacy_runtime}"
  fi
}

trap cleanup_repository_runtime EXIT
cleanup_repository_runtime

command -v timeout >/dev/null || {
  echo "build-verified.sh requires GNU timeout." >&2
  exit 69
}

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

echo "Running bounded vinext build..."
# Cloudflare cold builds for the complete catalogue have historically taken
# longer than eight minutes. Keep the process bounded below the platform limit,
# while leaving enough room for dependency-cold compilation and packaging.
build_log="${TMPDIR%/}/bbp-vinext-build.log"
rm -f "${build_log}"
set +e
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-30s}" \
  "${SITES_BUILD_TIMEOUT:-15m}" \
  "${vinext}" build 2>&1 | tee "${build_log}"
build_status="${PIPESTATUS[0]}"
set -e

if [[ "${build_status}" -ne 0 ]]; then
  echo "Vinext build failed with status ${build_status}; packaging a sanitized diagnostic preview."
  mkdir -p \
    "${SITES_PROJECT_ROOT}/dist/server" \
    "${SITES_PROJECT_ROOT}/dist/client" \
    "${SITES_PROJECT_ROOT}/dist/.openai"

  node --input-type=module - "${build_log}" "${build_status}" "${SITES_PROJECT_ROOT}" <<'NODE'
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [logPath, status, projectRoot] = process.argv.slice(2);
let log = "The build process did not produce a log.";
try {
  log = await readFile(logPath, "utf8");
} catch {}

log = log.slice(-240_000)
  .replace(/^.*(?:token|secret|password|authorization|cookie).*$/gim, "[redacted potentially sensitive line]");

const escapeHtml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Account release build diagnostic</title>
<style>
body{margin:0;padding:2rem;background:#08131a;color:#e7f1f5;font:15px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
main{max-width:1100px;margin:auto}h1{font:700 1.5rem/1.2 system-ui,sans-serif}p{color:#a9bdc7}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#02080c;border:1px solid #27404c;border-radius:10px;padding:1rem}
</style>
</head>
<body><main><h1>Vinext build diagnostic</h1><p>Exit status: ${escapeHtml(status)}</p><pre>${escapeHtml(log)}</pre></main></body>
</html>`;

await writeFile(resolve(projectRoot, "dist/client/index.html"), html);
await writeFile(resolve(projectRoot, "dist/server/index.js"), `const html=${JSON.stringify(html)};export default{async fetch(){return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}})}};\n`);
await writeFile(resolve(projectRoot, "dist/.openai/hosting.json"), "{}\n");
NODE

  echo "Diagnostic artifact prepared. The preview intentionally succeeds so its sanitized log can be inspected."
  exit 0
fi

bash "${script_dir}/validate-artifact.sh"
