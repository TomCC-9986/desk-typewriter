#!/bin/sh
# (old R2 flow, kept for reference: the site now uses static-asset parts — run `node prepare.mjs && wrangler deploy`)
# Needs R2 enabled on the Cloudflare account. Usage: sh download/publish.sh
set -e
cd "$(dirname "$0")"
W=../server/node_modules/.bin/wrangler
B=desk-typewriter-releases
V=$(sed -n 's/^export const VERSION = "\(.*\)";/\1/p' src/releases.ts)
$W r2 bucket create $B 2>/dev/null || true
for f in hero.webp:image/webp paper.jpg:image/jpeg icon-64.png:image/png icon-180.png:image/png; do
  $W r2 object put "$B/site/${f%%:*}" --file "assets/${f%%:*}" --content-type "${f##*:}" --remote
done
put() { $W r2 object put "$B/releases/$V/$1" --file "$2" --content-type "$3" --remote; }
put "desk-typewriter-$V-mac-arm64.dmg" "../安装包/桌面打字机-Mac(M芯片).dmg" application/x-apple-diskimage
put "desk-typewriter-$V-mac-x64.dmg" "../安装包/桌面打字机-Mac(Intel芯片).dmg" application/x-apple-diskimage
put "desk-typewriter-$V-win-x64.exe" "../安装包/桌面打字机-Windows安装.exe" application/vnd.microsoft.portable-executable
$W deploy
