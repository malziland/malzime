#!/usr/bin/env bash
# malziME Prüfstand-Stempler.
#
# Lässt alle drei Test-Suiten laufen und stempelt die Ergebnisse (Anzahl,
# Commit, Datum) automatisch in die drei Suiten-Zeilen von
# docs/VERIFICATION.md. Hintergrund (Konzept „Richtung 100" 2026-08-12):
# Die Verifikationsmatrix ist ein datierter Prüfstand — solange ein Mensch
# die Zahlen tippt, können sie veralten. Dieses Skript nimmt dem Menschen
# den Handgriff ab: Gestempelt wird NUR, was gerade wirklich grün gelaufen
# ist. Schlägt eine Suite fehl, wird NICHTS gestempelt.
#
# Nutzung: ./scripts/pruefstand.sh   (Dauer ~5 min, E2E inklusive)

set -euo pipefail
cd "$(dirname "$0")/.."

DATUM=$(date +%Y-%m-%d)
COMMIT=$(git rev-parse --short HEAD)
MATRIX="docs/VERIFICATION.md"

echo "Prüfstand-Lauf auf Commit $COMMIT ($DATUM) — alle drei Suiten, danach Stempel."

# ── 1. Backend (Jest) ──
echo "— Backend-Suite läuft…"
BACKEND_LOG=$(npm test --prefix functions 2>&1) || { echo "$BACKEND_LOG" | tail -20; echo "ABBRUCH: Backend-Suite rot — es wird nichts gestempelt."; exit 1; }
# OPS-2026-08-13-32: Zwei Fehler in einer Zeile, beide erst sichtbar, als ein
# Test bewusst uebersprungen wurde und die Ausgabe "1 skipped, 795 passed,
# 796 total" lautete:
#   1. Das Muster verlangte "passed" unmittelbar hinter "Tests:" und traf nicht
#      mehr.
#   2. Schwerer: Ohne `|| true` beendet ein leeres grep unter `set -e` und
#      `pipefail` das ganze Skript SOFORT. Die Plausibilitaetspruefung weiter
#      unten, die genau diesen Fall melden soll, wurde nie erreicht — der
#      Stempler starb wortlos mit Exit 1. Ein Werkzeug, das beim Melden eines
#      Problems selbst verstummt, ist die Ausfallform, gegen die dieses Projekt
#      ueberall anschreibt.
BACKEND=$(printf "%s" "$BACKEND_LOG" | grep -E "^Tests:" | grep -Eo "[0-9]+ passed" | grep -Eo "[0-9]+" | head -1 || true)
BACKEND_GESAMT=$(printf "%s" "$BACKEND_LOG" | grep -E "^Tests:" | grep -Eo "[0-9]+ total" | grep -Eo "[0-9]+" | head -1 || true)

# ── 2. Frontend (Vitest) ──
echo "— Frontend-Suite läuft…"
FRONTEND_LOG=$(npm run test:frontend 2>&1) || { echo "$FRONTEND_LOG" | tail -20; echo "ABBRUCH: Frontend-Suite rot — es wird nichts gestempelt."; exit 1; }
FRONTEND=$(printf "%s" "$FRONTEND_LOG" | grep -Eo "Tests\s+[0-9]+ passed" | grep -Eo "[0-9]+" | head -1 || true)

# ── 3. E2E (Playwright) ──
echo "— E2E-Suite läuft (dauert am längsten)…"
E2E_LOG=$(npm run test:e2e 2>&1) || { echo "$E2E_LOG" | tail -20; echo "ABBRUCH: E2E-Suite rot — es wird nichts gestempelt."; exit 1; }
E2E=$(printf "%s" "$E2E_LOG" | grep -Eo "[0-9]+ passed" | grep -Eo "[0-9]+" | tail -1 || true)

# ── Plausibilität: alle drei Zahlen müssen da sein ──
for WERT in "$BACKEND" "$FRONTEND" "$E2E"; do
  if ! [[ "$WERT" =~ ^[0-9]+$ ]] || [ "$WERT" -eq 0 ]; then
    echo "ABBRUCH: Testanzahl nicht lesbar (Backend=$BACKEND, Frontend=$FRONTEND, E2E=$E2E) — Ausgabeformat geändert?"
    exit 1
  fi
done

echo "Alle Suiten grün: Backend $BACKEND · Frontend $FRONTEND · E2E $E2E — Stempel wird gesetzt."

# ── Stempeln: nur die Ergebnis-Zelle der drei Suiten-Zeilen ersetzen ──
BACKEND="$BACKEND" BACKEND_GESAMT="$BACKEND_GESAMT" FRONTEND="$FRONTEND" E2E="$E2E" COMMIT="$COMMIT" DATUM="$DATUM" python3 - "$MATRIX" <<'EOF'
import os, re, sys

pfad = sys.argv[1]
text = open(pfad, encoding="utf-8").read()
b, f, e = os.environ["BACKEND"], os.environ["FRONTEND"], os.environ["E2E"]
stempel_ende = f"— `scripts/pruefstand.sh`, Commit {os.environ['COMMIT']}, {os.environ['DATUM']} |"

# Ein uebersprungener Test wird AUSGEWIESEN, nicht weggerechnet: "795/795 gruen"
# bei 796 Tests waere eine stille Schoenung genau der Art, die dieses Projekt
# beim Audit an sich selbst gefunden hat.
gesamt = os.environ.get("BACKEND_GESAMT") or b
uebersprungen = int(gesamt) - int(b) if gesamt.isdigit() else 0
b_text = f"{b}/{gesamt} grün ({uebersprungen} übersprungen)" if uebersprungen else f"{b}/{b} grün"

ersetzungen = [
    (r"(\| Backend-Unit-Tests \|[^|]+\|) [^|]+\|",  rf"\1 ✅ {b_text} {stempel_ende}"),
    (r"(\| Frontend-Unit-Tests \|[^|]+\|) [^|]+\|", rf"\1 ✅ {f}/{f} grün {stempel_ende}"),
    (r"(\| E2E kritischster Nutzerfluss[^|]*\|[^|]+\|) [^|]+\|", rf"\1 ✅ {e}/{e} grün {stempel_ende}"),
]
for muster, ersatz in ersetzungen:
    text, anzahl = re.subn(muster, ersatz, text, count=1)
    if anzahl != 1:
        print(f"ABBRUCH: Zeile zu Muster {muster!r} nicht gefunden — Tabellenaufbau geändert?")
        sys.exit(1)

open(pfad, "w", encoding="utf-8").write(text)
EOF

echo "Gestempelt in $MATRIX:"
grep -E "Backend-Unit-Tests|Frontend-Unit-Tests|E2E kritischster" "$MATRIX" | sed 's/^/  /'
echo "Fertig. Die Änderung wie üblich per Branch + PR auf main bringen."
