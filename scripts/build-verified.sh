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
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${vinext}" build

bash "${script_dir}/validate-artifact.sh"
