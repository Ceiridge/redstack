#!/bin/sh
# Renders the 3D images for the README with headless Chrome (software WebGL).
set -e
pnpm figures
chrome=$(command -v google-chrome || command -v chromium || command -v chromium-browser)
"$chrome" --headless=new --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
  --window-size=1400,700 --virtual-time-budget=15000 \
  --screenshot="$PWD/docs/images/cactus-farm-3d.png" "file://$PWD/out/figure-3d.html#figure"
"$chrome" --headless=new --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
  --window-size=1000,700 --virtual-time-budget=15000 \
  --screenshot="$PWD/docs/images/kelp-farm-3d.png" "file://$PWD/out/kelp-farm-3d.html#figure"
"$chrome" --headless=new --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
  --window-size=1000,700 --virtual-time-budget=15000 \
  --screenshot="$PWD/docs/images/kelp-twin-3d.png" "file://$PWD/out/kelp-twin-3d.html#figure"
"$chrome" --headless=new --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars \
  --window-size=1400,700 --virtual-time-budget=15000 \
  --screenshot="$PWD/docs/images/factory-3d.png" "file://$PWD/out/factory-3d.html#figure"
echo docs/images/factory-3d.png docs/images/cactus-farm-3d.png docs/images/kelp-farm-3d.png docs/images/kelp-twin-3d.png
