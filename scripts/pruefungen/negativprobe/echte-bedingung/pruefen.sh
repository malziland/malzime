#!/bin/sh
# ERWARTUNG: keine Fundstelle. Der Rueckgabewert ist hier die Bedingung,
# er wird also ausgewertet und nicht verworfen.
set -eu

if command -v firebase >/dev/null 2>&1; then
  echo "firebase vorhanden"
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud fehlt"
  exit 1
fi

if [ -d .git ] || git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Repository"
fi
