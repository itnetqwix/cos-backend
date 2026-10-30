#!/bin/bash
# Apply committed migrations only. No db push, no migrate reset, no .env edits.
set -euo pipefail
export HOME=/home/ubuntu
export NVM_DIR=/home/ubuntu/.nvm
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null
cd /home/ubuntu/cos-backend
test -f .env
npx prisma migrate status
npx prisma migrate deploy
