#!/bin/bash
# Deploy one commit already on origin/main. Does not migrate, does not touch .env.
# ponytail: keeps one previous SHA and dist snapshot. Add more snapshots if a rollback must skip two versions.
set -euo pipefail

SHA="${1:?commit sha required}"
APP=/home/ubuntu/cos-backend
REL=/home/ubuntu/cos-backend-releases

export HOME=/home/ubuntu
export PM2_HOME=/home/ubuntu/.pm2
export NVM_DIR=/home/ubuntu/.nvm
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null

cd "$APP"
test -f .env
test -f ecosystem.config.cjs
before=$(sha256sum .env | awk '{print $1}')

git fetch origin
git cat-file -e "${SHA}^{commit}"
git merge-base --is-ancestor "$SHA" origin/main
prev=$(git rev-parse HEAD)
mkdir -p "$REL"
printf '%s\n' "$prev" > "$REL/previous-sha"
if [ -d dist ]; then
  rm -rf "$REL/dist-previous"
  cp -a dist "$REL/dist-previous"
fi

restore_previous() {
  git checkout --detach "$prev"
  npm ci --no-audit --no-fund > /tmp/ripskis-npm-rollback.log
  npx prisma generate > /tmp/ripskis-prisma-rollback.log
  if [ -d "$REL/dist-previous" ]; then
    rm -rf dist
    cp -a "$REL/dist-previous" dist
  fi
  pm2 startOrReload ecosystem.config.cjs --update-env
}

git checkout --detach "$SHA"
after=$(sha256sum .env | awk '{print $1}')
test "$before" = "$after"

if ! npm ci --no-audit --no-fund > /tmp/ripskis-npm.log; then
  tail -n 40 /tmp/ripskis-npm.log >&2
  restore_previous
  exit 1
fi
npx prisma generate > /tmp/ripskis-prisma.log
if ! npm run build > /tmp/ripskis-build.log; then
  tail -n 40 /tmp/ripskis-build.log >&2
  restore_previous
  exit 1
fi

pm2 startOrReload ecosystem.config.cjs --update-env
sleep 3

health_ok() {
  curl -fsS --max-time 20 "$1" | grep -q '"database":"up"'
}

if ! health_ok http://127.0.0.1:5000/api/v1/health || ! health_ok https://api.ripskis.com/api/v1/health; then
  echo "health check failed; rolling back to $prev" >&2
  restore_previous
  exit 1
fi

pids=$(pm2 pid ripskis-backend)
test "$(echo "$pids" | wc -w)" -eq 1
echo "deployed $SHA (previous $prev)"
pm2 status
