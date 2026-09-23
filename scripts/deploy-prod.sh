#!/bin/sh
# Ships the app to humansat.work and restarts the floor server there.
set -eu
cd "$(dirname "$0")/.."
npm run build
rsync -avz --delete \
  --exclude .DS_Store \
  --exclude .git \
  --exclude node_modules \
  --exclude dist \
  --exclude .env \
  --exclude .env.local \
  --exclude data/accounts.json \
  --exclude data/metrics.json \
  --exclude data/presence.json \
  --exclude data/presence.json.tmp \
  --exclude data/conference-reservations.json \
  --exclude data/office-ads \
  -e "ssh -i ${HOME}/.ssh/dcl-threejs-gha -o IdentitiesOnly=yes" \
  ./ root@humansat.work:/root/express/humans-at-work/
ssh -i "${HOME}/.ssh/dcl-threejs-gha" -o IdentitiesOnly=yes root@humansat.work \
  'export PATH="/root/.nvm/versions/node/v20.20.2/bin:$PATH"; cd /root/express/humans-at-work && npm install && pm2 restart humans-at-work'
