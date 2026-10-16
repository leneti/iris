#!/usr/bin/env bash
# Run a command with the repo's Node and keep every cache and temp file inside the repo.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh"
nvm use --silent 24.21.0

export TMPDIR="$REPO/.tmp"
export npm_config_cache="$REPO/.tmp/npm"
export COREPACK_HOME="$REPO/.tmp/corepack"
export XDG_CACHE_HOME="$REPO/.tmp/cache"
export YARN_GLOBAL_FOLDER="$REPO/.tmp/yarn"
export NEXT_TELEMETRY_DISABLED=1
mkdir -p "$TMPDIR/corepack" "$YARN_GLOBAL_FOLDER"
# The repo package.json is "type": "module"; the bundled Yarn release under .tmp is CommonJS.
[ -f "$TMPDIR/package.json" ] || echo '{"private":true,"type":"commonjs"}' > "$TMPDIR/package.json"

cd "$REPO"
if [ "${1:-}" = "yarn" ]; then
  exec corepack "$@"
fi
exec "$@"
