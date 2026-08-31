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
UNGEMESSEN=0
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
  elif [ "$RC" -eq 2 ]; then
    # OPS-2026-08-31-12: Rueckgabewert 2 heisst ueberall in diesem Projekt
    # "nicht messbar" — die Pruefung konnte nicht stattfinden. Das ist weder
    # gruen (nichts wurde belegt) noch rot (nichts ist kaputt). Vorher fiel
    # dieser Fall unter "sonst" und haette jeden Push blockiert; davor meldete
    # die Selbstpruefung sogar 0 und log damit ein "ok".
    printf '  ?     %s   (NICHT MESSBAR — kein Beleg)\n' "$BESCHREIBUNG"
    printf '%s\n' "$AUSGABE" | sed 's/^/        /' | tail -8
    UNGEMESSEN=$((UNGEMESSEN + 1))
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
lauf "Pruefungen: Deploy-Riegel" "pruefungen" python3 scripts/pruefe-deploy-riegel.py
lauf "Pruefungen: Waechter-Selbstpruefung" "pruefungen" bash scripts/selbstpruefung-waechter.sh
# BEFUND 31.08.2026 (Runde 2, P1): Die Projektkonvention verlangt
# `npm ci --dry-run` in Root UND functions/ — umgesetzt war sie nirgends.
# Deshalb konnten zerstoerte Paketnamen ("eslint --max-warnings=0" als
# Abhaengigkeit) durch diese Vorabpruefung gehen: 22 Schritte gruen, waehrend
# `npm ci` in beiden Baeumen abbrach. npm ci ist der ERSTE Schritt von
# test-backend, test-frontend und test-e2e — drei der sechs Pflicht-Checks.
lauf "Lockfile: npm ci (Wurzel)" "test-frontend" npm ci --dry-run
lauf "Lockfile: npm ci (functions)" "test-backend" npm ci --dry-run --prefix functions
lauf "Pruefungen: Fremddateien" "pruefungen" node scripts/pruefe-fremddateien.mjs
lauf "Pruefungen: Vendorierung" "pruefungen" node scripts/pruefe-vendorierung.mjs
lauf "Zeitzuender (Backend)" "test-backend" sh scripts/pruefe-zeitzuender.sh . --nur backend
lauf "Zeitzuender (Frontend)" "test-frontend" sh scripts/pruefe-zeitzuender.sh . --nur frontend

DAUER=$(($(date +%s) - START))
echo "-----------------------------------------------------------"

if [ "$FEHLER" -eq 0 ] && [ "$UNGEMESSEN" -eq 0 ]; then
  echo "Alles gruen in ${DAUER} s. Die langen Suiten (Backend, E2E) fehlen hier"
  echo "bewusst — vor einem Release faehrt scripts/pruefstand.sh alles ab."
  exit 0
fi

if [ "$FEHLER" -eq 0 ]; then
  # OPS-2026-08-31-12: Kein Fehler, aber auch kein vollstaendiger Beleg.
  # "Alles gruen" waere hier eine Luege ueber etwas, das nie gemessen wurde.
  printf 'GRUEN, ABER UNVOLLSTAENDIG: %s Pruefung(en) konnten nicht messen.\n' "$UNGEMESSEN"
  echo ""
  echo "Nichts ist kaputt — aber fuer diese Punkte liegt kein Nachweis vor."
  echo "Meist genuegt: committen oder aufraeumen, dann erneut laufen lassen."
  # BEFUND 31.08.2026 (Runde 2, neu gefunden): Hier stand `exit 0`. Der
  # pre-push-Riegel prueft `-ne 0` und liess den Push damit DURCH — waehrend
  # die Pipeline denselben Waechter direkt aufruft, wo Rueckgabewert 2 den
  # Pflicht-Check ROT macht. Der Riegel oeffnete sich fuer genau den Fall, fuer
  # den er neu gebaut worden war. Jetzt gilt: Was die Pipeline anhaelt, haelt
  # auch hier an — aber mit eigenem Wert, damit die Meldung stimmt.
  exit 2
fi

printf 'ROT: %s Pruefung(en) wuerden die Pipeline brechen:%s\n' "$FEHLER" "$LISTE"
echo ""
echo "Erst beheben, dann pushen. Das spart pro Fehlschlag rund acht Minuten"
echo "Wartezeit an der Pipeline."
exit 1
