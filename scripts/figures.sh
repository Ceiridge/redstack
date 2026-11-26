#!/bin/sh
# Renders the 3D hero image for the README with headless Chrome (software WebGL).
set -e
pnpm figures
chrome=$(command -v google-chrome || command -v chromium || command -v chromium-browser)
"$chrome" --headless=new --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
  --window-size=1400,700 --virtual-time-budget=15000 \
  --screenshot="$PWD/docs/images/cactus-farm-3d.png" "file://$PWD/out/figure-3d.html#figure"
echo docs/images/cactus-farm-3d.png
