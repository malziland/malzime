#!/bin/sh
set -eu
git push origin main && echo "Deploy erfolgreich"
npm run build
