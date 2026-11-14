#!/bin/sh
# @cloudflare/vitest-pool-workers breaks when the project path contains non-ASCII characters
# (module fallback service + MF-Vitest-Worker-Data header). The real node_modules lives in an
# ASCII mirror dir (server/node_modules is a symlink to it); we rsync sources there and run vitest.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
MIRROR="${DT_MIRROR:-$HOME/.dt-mirror}"
mkdir -p "$MIRROR/server" "$MIRROR/shared"
rsync -a --delete "$HERE/../shared/" "$MIRROR/shared/"
for d in src test; do mkdir -p "$MIRROR/server/$d"; rsync -a --delete "$HERE/$d/" "$MIRROR/server/$d/"; done
cp "$HERE/package.json" "$HERE/tsconfig.json" "$HERE/wrangler.toml" "$HERE/vitest.config.ts" "$MIRROR/server/"
cd "$MIRROR/server"
exec npx vitest run "$@"
