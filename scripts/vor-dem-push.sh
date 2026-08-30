#!/bin/sh
# vor-dem-push.sh — faehrt genau die BILLIGEN Pruefungen der Pipeline ab,
# in derselben Reihenfolge, vor dem Push.
#
# Warum es das gibt: Am 2026-08-13 gingen drei Pipeline-Laeufe rot. Zwei davon
# waren reine Nachlaessigkeit — Prettier nicht gelaufen, die vendorierte Kopie
# statt der Quelle bearbeitet. Beide haetten diese Pruefungen gefangen. Sie
# dauern zusammen wenige Sekunden; ein roter Lauf kostet dagegen Push, dreieinhalb
# Minuten Warten, Protokoll lesen, beheben und noch einmal dasselbe.
#
# Was hier ABSICHTLICH FEHLT: die Backend- und die E2E-Suite. Sie laufen lokal
# ungefaehr so lang wie in der Pipeline, weil GitHub sie auf mehrere Maschinen
# verteilt. Dort gaebe es nichts zu gewinnen. Wer sie will, nimmt
# scripts/pruefstand.sh — das ist der Lauf vor einem Release.
#
# Kein `set -e`: Dieses Skript ist ein Sammel-Berichter. Es soll ALLE Mangel
# zeigen, nicht beim ersten stehenbleiben (Entscheidung E-001 der Familie).

WURZEL=$(cd "$(dirname "$0")/.." && pwd)
cd "$WURZEL" || exit 2

FEHLER=0
LISTE=""

# Fuehrt einen Schritt aus und merkt sich den Rueckgabewert.
# Die Ausgabe wird nur bei einem Mangel gezeigt — sonst bleibt der Lauf ruhig.
lauf() {
  BESCHREIBUNG="$1"
  CI_JOB="$2"
  shift 2
  AUSGABE=$("$@" 2>&1)
  RC=$?
  if [ "$RC" -eq 0 ]; then
    printf '  ok    %s\n' "$BESCHREIBUNG"
  else
    printf '  ROT   %s   (Pipeline-Job: %s)\n' "$BESCHREIBUNG" "$CI_JOB"
    printf '%s\n' "$AUSGABE" | sed 's/^/        /' | tail -20
    FEHLER=$((FEHLER + 1))
    LISTE="$LISTE
  - $BESCHREIBUNG  ($CI_JOB)"
  fi
}

START=$(date +%s)
echo "Vor dem Push — die billigen Pruefungen der Pipeline"
echo "-----------------------------------------------------------"

# ── Job: test-frontend ──────────────────────────────────────────────────────
lauf "Frontend: Lint" "test-frontend" npm run --silent lint:frontend
lauf "Frontend: Format" "test-frontend" npm run --silent format:frontend:check
lauf "Frontend: Unit-Tests" "test-frontend" npm run --silent test:frontend

# ── Job: test-backend (ohne die lange Suite) ────────────────────────────────
lauf "Backend: Abhaengigkeits-Gate" "test-backend" node scripts/audit-gate.mjs functions .
lauf "Backend: Lint" "test-backend" sh -c 'cd functions && npm run --silent lint'
lauf "Backend: Format" "test-backend" sh -c 'cd functions && npm run --silent format:check'

# ── Job: pruefungen ─────────────────────────────────────────────────────────
lauf "Pruefungen: Selbstpruefung" "pruefungen" sh scripts/pruefungen/selbstpruefung.sh
lauf "Pruefungen: Aussentext-Sperrliste" "pruefungen" python3 scripts/pruefungen/checks/aussentext.py .
lauf "Pruefungen: Fakten-Drift" "pruefungen" python3 scripts/pruefungen/checks/fakten-drift.py .
lauf "Pruefungen: Stiller Fehlschlag" "pruefungen" python3 scripts/pruefungen/checks/stiller-fehlschlag.py .
lauf "Pruefungen: Tests ohne Zusicherung" "pruefungen" python3 scripts/pruefungen/checks/test-blind.py .
lauf "Pruefungen: Sichtbare Texte" "pruefungen" python3 scripts/pruefe-i18n-fallbacks.py
lauf "Pruefungen: Tote Geduld" "pruefungen" python3 scripts/pruefe-tote-geduld.py
lauf "Pruefungen: Doppelte Betriebswerte" "pruefungen" python3 scripts/pruefe-doppelte-werte.py
lauf "Pruefungen: Mitzieher" "pruefungen" python3 scripts/pruefe-mitzieher.py
lauf "Pruefungen: Kopplung" "pruefungen" python3 scripts/pruefe-kopplung.py
lauf "Pruefungen: Fremddateien" "pruefungen" node scripts/pruefe-fremddateien.mjs
lauf "Pruefungen: Vendorierung" "pruefungen" node scripts/pruefe-vendorierung.mjs
lauf "Zeitzuender (Backend)" "test-backend" sh scripts/pruefe-zeitzuender.sh . --nur backend
lauf "Zeitzuender (Frontend)" "test-frontend" sh scripts/pruefe-zeitzuender.sh . --nur frontend

DAUER=$(($(date +%s) - START))
echo "-----------------------------------------------------------"

if [ "$FEHLER" -eq 0 ]; then
  echo "Alles gruen in ${DAUER} s. Die langen Suiten (Backend, E2E) fehlen hier"
  echo "bewusst — vor einem Release faehrt scripts/pruefstand.sh alles ab."
  exit 0
fi

printf 'ROT: %s Pruefung(en) wuerden die Pipeline brechen:%s\n' "$FEHLER" "$LISTE"
echo ""
echo "Erst beheben, dann pushen. Das spart pro Fehlschlag rund acht Minuten"
echo "Wartezeit an der Pipeline."
exit 1
