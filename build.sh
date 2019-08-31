#!/bin/bash
set -euo pipefail

tsc

ncc build src/index.js -o dist/main
mv dist/main/index.js dist/index.js
rm -rf dist/main
