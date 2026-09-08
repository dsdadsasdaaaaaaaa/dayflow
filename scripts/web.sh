#!/bin/bash
# Dev server launcher.
#
# Uses whatever `node` is on PATH, and only reaches for nvm when that node is
# too old — the Mac this started on had Node 16 as the system default with a
# newer one under nvm, and hardcoding that path broke the moment the project
# moved to a machine that installs Node the ordinary way.
need=20
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$need" ]; then
  for dir in "$HOME/.nvm/versions/node"/*/bin; do
    [ -x "$dir/node" ] && export PATH="$dir:$PATH"
  done
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$need" ]; then
  echo "Node $need or newer is needed (found $(node -v)). Install it from nodejs.org or with nvm." >&2
  exit 1
fi
cd "$(dirname "$0")/.."
exec npx expo start --web --port 8081
