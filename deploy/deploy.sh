#!/usr/bin/env bash
#
# Deploy the latest origin/main to this server.
#   ssh tajamul-dev@localhost -p 2222
#   /var/www/myapp/deploy/deploy.sh
#
# set -euo pipefail matters here: without it, a failed `git pull` would fall
# through to the restart and report a successful deploy having changed nothing.
set -euo pipefail

APP_DIR="/var/www/myapp"
SERVICE="myapp"
HEALTH="http://127.0.0.1:3000/health"

cd "$APP_DIR"

BEFORE="$(git rev-parse --short HEAD)"
echo "==> Currently deployed: $BEFORE"

echo "==> Pulling latest code"
git pull --ff-only

AFTER="$(git rev-parse --short HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "==> Already up to date at $BEFORE"
else
  echo "==> Updated: $BEFORE -> $AFTER"
fi

# npm ci, not npm install: installs exactly what package-lock.json pins and
# fails loudly if the lockfile and package.json disagree. Reproducible.
echo "==> Installing production dependencies"
npm ci --omit=dev

# Node read server.js into memory at boot; it has no idea the file changed.
echo "==> Restarting $SERVICE"
sudo systemctl restart "$SERVICE"

# Type=simple means systemd reports success the moment the process is spawned,
# before it has bound the port. Poll rather than assume.
echo "==> Waiting for health check"
for i in $(seq 1 10); do
  if curl -sf "$HEALTH" > /dev/null; then
    echo "==> Healthy after ${i}s"
    curl -s "$HEALTH"; echo
    echo "==> Live commit: $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

echo "==> FAILED: no healthy response after 10s"
sudo systemctl status "$SERVICE" --no-pager || true
journalctl -u "$SERVICE" -n 30 --no-pager || true
exit 1
