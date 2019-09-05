#!/bin/bash
set -euo pipefail

tsc

ncc build src/dev-server.ts -o dist/dev
mv dist/dev/index.js dist/dev-server.js
rm -rf dist/dev

ncc build src/index.js -o dist/main
mv dist/main/index.js dist/index.js
rm -rf dist/main

cp node_modules/@now/next/dist/now__bridge.js dist/now__bridge.js
cp node_modules/@now/next/dist/templated-launcher.js dist/templated-launcher.js
