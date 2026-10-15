#!/usr/bin/env bash
# Build and pack dist/ + a tiny python server into a tarball you can scp anywhere.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-../voxel-carnage-express-dist.tar.gz}"
npm run build
STAGE="$(mktemp -d)/voxel-carnage-express-dist"
mkdir -p "$STAGE"
cp -r dist/. "$STAGE/"
cat > "$STAGE/serve.sh" <<'SH'
#!/usr/bin/env sh
# Serve Voxel Carnage Express on 0.0.0.0:${PORT:-5199}
cd "$(dirname "$0")"
PORT="${PORT:-5199}"
echo "Voxel Carnage Express -> http://localhost:$PORT/"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
SH
chmod +x "$STAGE/serve.sh"
cat > "$STAGE/README.txt" <<'TXT'
Voxel Carnage Express (static build)

  ./serve.sh                 # http://localhost:5199/
  PORT=8080 ./serve.sh       # another port

Open in Chromium or Firefox. Click "All aboard" (that also unlocks audio).
W/S throttle, Space whistle, C camera, R skip replay, N night, M mute, 1-9 + click to drop targets.
URL options: ?seed=42  ?radius=110 (shorter view distance for weaker GPUs)
TXT
tar -C "$(dirname "$STAGE")" -czf "$OUT" voxel-carnage-express-dist
echo "packed $(realpath "$OUT")"
