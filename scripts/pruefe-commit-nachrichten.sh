#!/bin/sh
# pruefe-commit-nachrichten.sh — Commit-Nachrichten sind oeffentlich; Abwaegungen
# ueber Rechtsrisiken gehoeren nicht hinein.
#
# ANLASS (08.09.2026): Ein Commit-Titel auf main nannte "Rechtsrisiko-Abwaegungen".
# Der Doku-Waechter (keine-rechtsrisiken-oeffentlich.test.js) prueft Dateien —
# eine Commit-Nachricht sah er nicht. Diese Pruefung schliesst die Luecke fuer
# alles, was noch nicht auf origin/main liegt; was dort ist, laesst sich nicht
# mehr zuruecknehmen.
#
# Aufruf:  sh scripts/pruefe-commit-nachrichten.sh            (Commits seit origin/main)
#          sh scripts/pruefe-commit-nachrichten.sh --probe "Text"   (Negativprobe)
# Rueckgabe: 0 sauber · 1 Fund · 2 nicht messbar (kein origin/main).
MUSTER='[Pp]atent|[Rr]echtsrisik|[Rr]isiko wird getragen|[Hh]aftungsrisik|risk is (accepted|borne)'
if [ "${1:-}" = "--probe" ]; then
  printf '%s\n' "${2:-}" | grep -Eq "$MUSTER" && { echo "FUND (Probe): $2"; exit 1; } || { echo "sauber (Probe)"; exit 0; }
fi
# In der Pipeline (PR-Checkout) fehlt origin/main oft — einmal nachholen. Ob es
# geklappt hat, prueft die Zeile danach ausdruecklich (Rueckgabe 2 = nicht messbar).
if ! git rev-parse --verify -q origin/main >/dev/null 2>&1; then
  git fetch --no-tags -q origin main:refs/remotes/origin/main >/dev/null 2>&1 || echo "Hinweis: origin/main konnte nicht geholt werden."
fi
git rev-parse --verify -q origin/main >/dev/null || { echo "NICHT MESSBAR: origin/main unbekannt."; exit 2; }
FUNDE=$(git log origin/main..HEAD --format='%h %s%n%b' 2>/dev/null | grep -En "$MUSTER" || true)
if [ -n "$FUNDE" ]; then
  echo "COMMIT-NACHRICHT MIT RECHTSRISIKO-FORMULIERUNG (oeffentlich, nicht zuruecknehmbar nach dem Push):"
  printf '%s\n' "$FUNDE" | sed 's/^/  /'
  echo "Abhilfe: git commit --amend (oder rebase) mit neutralem Wortlaut; die Abwaegung gehoert nach docs/handover/."
  exit 1
fi
echo "sauber: $(git rev-list --count origin/main..HEAD) Commit(s) seit origin/main ohne Fund."
exit 0
