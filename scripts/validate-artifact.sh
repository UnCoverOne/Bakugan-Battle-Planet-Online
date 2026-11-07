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

# Cloudflare Vite creates a redirected configuration for deploy and Preview.
# Guard its actual output, not just the source wrangler.jsonc: duplicated
# local DB placeholders can otherwise pass build validation and fail later.
generated_config="${SITES_PROJECT_ROOT}/dist/server/wrangler.json"
[[ -f "${generated_config}" ]] || {
  echo "Missing generated Worker configuration: dist/server/wrangler.json" >&2
  exit 66
}
node --input-type=module - "${generated_config}" <<'NODE'
import { readFileSync } from "node:fs";
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
function checkUnique(scope, resource, key) {
  const names = (scope[resource] ?? []).map((item) => item[key]).filter(Boolean);
  const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
  if (duplicates.length) {
    console.error(`Duplicate generated ${resource} bindings: ${[...new Set(duplicates)].join(", ")}`);
    process.exitCode = 1;
  }
  return names;
}
const productionDB = checkUnique(config, "d1_databases", "binding");
const previewDB = checkUnique(config.previews ?? {}, "d1_databases", "binding");
checkUnique(config, "r2_buckets", "binding");
checkUnique(config.previews ?? {}, "r2_buckets", "binding");
const prodIds = new Set((config.d1_databases ?? []).map((item) => item.database_id));
if ((config.previews?.d1_databases ?? []).some((item) => prodIds.has(item.database_id))) {
  console.error("Unsafe Preview: production D1 database is reused.");
  process.exitCode = 1;
}
const prodBuckets = new Set((config.r2_buckets ?? []).map((item) => item.bucket_name));
if ((config.previews?.r2_buckets ?? []).some((item) => prodBuckets.has(item.bucket_name))) {
  console.error("Unsafe Preview: production R2 bucket is reused.");
  process.exitCode = 1;
}
console.log(`Generated bindings: production D1=[${productionDB.join(", ")}]; preview D1=[${previewDB.join(", ")}]`);
NODE

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
