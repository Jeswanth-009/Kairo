#!/usr/bin/env bash
# Assembles the static website into site-dist/ for GitHub Pages:
#   site-dist/         the landing page (website/)
#   site-dist/demo/    the browser demo (vite mock-harness build)
# Run locally with `bash scripts/build-site.sh` and serve site-dist/ with any
# static file server; the Website workflow runs the same script in CI.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf site-dist dist-demo
mkdir -p site-dist

cp -r website/. site-dist/

# Keep the landing page's version fallback in sync with package.json — the
# runtime JS fetch overrides it again when the GitHub API is reachable.
VERSION=$(node -p "require('./package.json').version")
for id in hero-version dl-version dl-fact-version; do
  sed -i "s/<span id=\"$id\">[^<]*</<span id=\"$id\">v${VERSION}</" site-dist/index.html
done

npx vite build --config vite.demo.config.ts

mkdir -p site-dist/demo
cp -r dist-demo/. site-dist/demo/
mv site-dist/demo/mock.html site-dist/demo/index.html

rm -rf dist-demo
echo "site assembled at site-dist/ ($(du -sh site-dist | cut -f1))"
