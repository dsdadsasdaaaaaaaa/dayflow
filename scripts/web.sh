#!/bin/bash
# Dev server launcher — ensures Node 20+ is used (system default is Node 16).
export PATH="/Users/levisilverberg/.nvm/versions/node/v20.20.2/bin:$PATH"
cd "$(dirname "$0")/.."
exec npx expo start --web --port 8081
