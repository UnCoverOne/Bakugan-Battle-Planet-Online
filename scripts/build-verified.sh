#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec bash "${script_dir}/sites-env.sh" -- bash "$0" "$@"
fi

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
# Keep cold Cloudflare builds bounded below the platform limit while allowing
# enough time for dependency-cold compilation and packaging.
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-30s}" \
  "${SITES_BUILD_TIMEOUT:-15m}" \
  "${vinext}" build

bash "${script_dir}/validate-artifact.sh"
