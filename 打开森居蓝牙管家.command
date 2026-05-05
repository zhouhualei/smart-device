#!/bin/zsh
cd "$(dirname "$0")"
NODE="$PWD/.runtime/node-v20.12.2-darwin-x64/bin/node"
export PATH="$PWD/.runtime/node-v20.12.2-darwin-x64/bin:$PATH"

if [ -x "$NODE" ] && [ -f "$PWD/node_modules/electron/cli.js" ]; then
  exec arch -x86_64 "$NODE" "$PWD/node_modules/electron/cli.js" "$PWD"
else
  open "index.html"
fi
