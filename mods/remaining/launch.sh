#!/bin/sh
set -eu
mod_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
target="$mod_dir/usage.mjs"
case "${1-}" in
  --themes) target="$mod_dir/themes.mjs"; shift ;;
  --diagnose) target="$mod_dir/diagnose.mjs"; shift ;;
  --recommend) target="$mod_dir/recommend.mjs"; shift ;;
  --settings-backup) target="$mod_dir/settings-backup.mjs"; shift ;;
esac
if command -v node >/dev/null 2>&1; then
  exec node "$target" "$@"
fi
for node_bin in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.local/bin/node"; do
  if [ -x "$node_bin" ]; then exec "$node_bin" "$target" "$@"; fi
done
printf '%s\n' '{"accounts":[],"error":"Node.js 18 or newer is required"}'
exit 1
