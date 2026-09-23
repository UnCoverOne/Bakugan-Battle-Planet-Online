#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

worker="${SITES_PROJECT_ROOT}/dist/server/index.js"
client_dir="${SITES_PROJECT_ROOT}/dist/client"
wrangler="${SITES_PROJECT_ROOT}/node_modules/.bin/wrangler"

[[ -f "${worker}" ]] || {
  echo "Missing Cloudflare Worker entry: dist/server/index.js" >&2
  exit 66
}

[[ -d "${client_dir}" ]] || {
  echo "Missing client artifact directory: dist/client" >&2
  exit 66
}

# Syntax-check the generated module without importing it in Node. Modern vinext
# emits Cloudflare-native specifiers such as cloudflare:workers, which are valid
# in workerd but cannot be resolved by Node's default ESM loader.
node --check "${worker}"

# vinext < 1.0.0-beta.7 could leak its build-time file:///ROOT base into
# deployed browser Worker URLs. Keep this as a deployment regression guard.
if grep -R -I -F -q "file:///ROOT" "${client_dir}"; then
  echo "Invalid deployed Web Worker URL base detected in dist/client: file:///ROOT" >&2
  exit 65
fi

[[ -x "${wrangler}" ]] || {
  echo "wrangler is unavailable for Cloudflare artifact validation." >&2
  exit 69
}

# Let Wrangler/workerd validate Cloudflare-native module resolution instead of
# executing the Worker artifact under Node. This is a dry run only.
validation_dir="$(mktemp -d)"
cleanup_validation() {
  rm -rf -- "${validation_dir}"
}
trap cleanup_validation EXIT

timeout \
  --signal=TERM \
  --kill-after="${SITES_VALIDATION_KILL_AFTER:-10s}" \
  "${SITES_VALIDATION_TIMEOUT:-90s}" \
  "${wrangler}" deploy \
  --dry-run \
  --config "${SITES_PROJECT_ROOT}/wrangler.jsonc" \
  --outdir "${validation_dir}" \
  >/dev/null

echo "Validated Cloudflare artifact with Wrangler; deployed browser Worker URLs contain no file:///ROOT base."
