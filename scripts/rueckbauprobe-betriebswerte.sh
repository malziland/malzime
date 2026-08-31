#!/bin/sh
# rueckbauprobe-betriebswerte.sh — sind die Fixes wirklich abgesichert?
#
# WAS DAS HIER TUT: Jeder behobene Befund wird absichtlich wieder eingebaut,
# dann laeuft die zustaendige Testsuite. Wird sie NICHT rot, ist der Fix
# ungedeckt — er koennte bei einem Merge oder Refactoring still zurueckfallen,
# ohne dass es jemand merkt.
#
# WARUM ES DAS GIBT (30.08.2026): Nach dem Firestore-Umbau waren alle 1017
# Tests gruen. Diese Probe zeigte, dass SECHS VON ZEHN Fixes durch keinen
# einzigen Test gedeckt waren — darunter beide Datenschutz-Obergrenzen, die
# nur von Hand geprueft worden waren. Eine Pruefung, die niemand wiederholt,
# ist keine.
#
# Die Luecken sind in src/__tests__/rueckfall-riegel.test.js geschlossen.
# Diese Probe bleibt als Kontrolle: Wer die Riegel abbaut, sieht es hier.
#
# Aufruf aus der Repo-Wurzel:  sh scripts/rueckbauprobe-betriebswerte.sh
# Dauer: rund 3 Minuten. Kein Netz, keine Kosten. Veraendert nichts dauerhaft —
# jede Aenderung wird sofort zurueckgenommen.

WURZEL=$(cd "$(dirname "$0")/.." && pwd)
cd "$WURZEL/functions" || exit 1
UNGEDECKT=0

probe() {
  NAME="$1"; DATEI="$2"; ALT="$3"; NEU="$4"; SUITE="$5"
  cp "$DATEI" "$DATEI.probe-bak"
  python3 - "$DATEI" "$ALT" "$NEU" <<'PY'
import sys
p, alt, neu = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
if alt not in s:
    print("MUSTER-NICHT-GEFUNDEN"); sys.exit(9)
open(p, "w").write(s.replace(alt, neu, 1))
PY
  if [ $? -eq 9 ]; then
    # Das Muster passt nicht mehr — der Code wurde umgebaut. Das ist KEIN
    # gruenes Ergebnis: Die Probe hat nichts gemessen und muss nachgezogen
    # werden. Sonst schrumpft die Kontrolle still, waehrend sie gruen meldet.
    printf "  %-52s MUSTER FEHLT — Probe nachziehen!\n" "$NAME"
    UNGEDECKT=$((UNGEDECKT + 1))
    mv "$DATEI.probe-bak" "$DATEI"; return
  fi
  if npx jest --silent $SUITE >/dev/null 2>&1; then
    printf "  %-52s GRUEN GEBLIEBEN — UNGEDECKT\n" "$NAME"
    UNGEDECKT=$((UNGEDECKT + 1))
  else
    printf "  %-52s wird rot — gedeckt\n" "$NAME"
  fi
  mv "$DATEI.probe-bak" "$DATEI"
}

echo "── Rueckbauprobe: merkt die Testkette den Rueckfall? ────────"
echo

# OPS-2026-08-31-08: Der Code steht seit der Aufteilung in mistral-http.js.
# Die Probe suchte weiter in mistral.js und meldete MUSTER-NICHT-GEFUNDEN —
# sie konnte den Rueckfall also gar nicht mehr pruefen. pruefe-mitzieher.py
# kennt diese Kopplung nicht (siehe Regel unten).
probe "1. Rueckfall auf Code-Zeitgrenze in mistral-http.js" \
  "src/mistral-http.js" \
  'if (typeof timeoutCapMs !== "number" || !(timeoutCapMs > 0)) {
      throw new Error("callMistral: timeoutCapMs fehlt (mistralTimeoutMs aus dem Einstellungssatz)");
    }
    const cap = timeoutCapMs;' \
  'const cap = timeoutCapMs == null ? 90000 : timeoutCapMs;' \
  "src/__tests__/ohne-einstellungssatz.test.js src/__tests__/rueckfall-riegel.test.js src/__tests__/mistral.test.js"

probe "2. Rueckfall auf Code-Karenzfrist in jobs.js" \
  "src/jobs.js" \
  'if (typeof gnadenfristMs !== "number" || !(gnadenfristMs > 0)) {
    throw new Error("isAbandoned: livenessGnadenfristMs fehlt");
  }
  const frist = gnadenfristMs;' \
  'const frist = typeof gnadenfristMs === "number" && gnadenfristMs > 0 ? gnadenfristMs : 480000;' \
  "src/__tests__/ohne-einstellungssatz.test.js src/__tests__/rueckfall-riegel.test.js src/__tests__/jobs.test.js"

probe "3. Datenschutz: IP-Fenster wieder auf 24 h oeffnen" \
  "src/betriebsprofil.js" \
  'adressfensterMs: { min: 1000, max: 10 * 60 * 1000 },' \
  'adressfensterMs: { min: 1000, max: 24 * 60 * 60 * 1000 },' \
  "src/__tests__/betriebsprofil-grenzfaelle.test.js src/__tests__/rueckfall-riegel.test.js src/__tests__/betriebsprofil.test.js src/__tests__/satz-gegen-doku.test.js"

probe "4. Datenschutz: Aufbewahrung wieder auf 7 Tage oeffnen" \
  "src/betriebsprofil.js" \
  'jobAufbewahrungMs: { min: 60 * 1000, max: 2 * 60 * 60 * 1000 },' \
  'jobAufbewahrungMs: { min: 60 * 1000, max: 7 * 24 * 60 * 60 * 1000 },' \
  "src/__tests__/betriebsprofil-grenzfaelle.test.js src/__tests__/rueckfall-riegel.test.js src/__tests__/betriebsprofil.test.js src/__tests__/satz-gegen-doku.test.js"

probe "5. Wartezeit-Ansage wieder mit fester Zahl rechnen" \
  "src/handle-job-status.js" \
  'const { werte } = await geltendeWerte();
  if (!werte || !sekunden) return null;
  return Math.ceil(position / werte.parallelitaet) * sekunden;' \
  'return Math.ceil(position / 7) * sekunden;' \
  "src/__tests__/ohne-einstellungssatz.test.js src/__tests__/rueckfall-riegel.test.js src/__tests__/handle-job-status.test.js src/__tests__/handle-job-status-livetext.test.js"

probe "6. Einlassgrenze ohne Satz wieder auf 155" \
  "src/handle-enqueue.js" \
  'if (!werte) return 0;' \
  'if (!werte) return 155;' \
  "src/__tests__/ohne-einstellungssatz.test.js src/__tests__/rueckfall-riegel.test.js src/__tests__/einlassgrenze-profil.test.js"

probe "7. Boost ohne Satz wieder durchlassen (fail-open)" \
  "src/counter.js" \
  'if (!satzwerte) {' \
  'if (false) {' \
  "src/__tests__/ohne-einstellungssatz.test.js src/__tests__/rueckfall-riegel.test.js src/__tests__/counter.test.js"

probe "8. Rate-Limit-Rueckfall in middleware.js" \
  "src/middleware.js" \
  'if (typeof grenze !== "number" || !(grenze > 0)) throw new Error("checkRateLimit: adressLimit fehlt");' \
  'grenze = typeof grenze === "number" && grenze > 0 ? grenze : 500;' \
  "src/__tests__/middleware.test.js src/__tests__/ohne-einstellungssatz.test.js src/__tests__/rueckfall-riegel.test.js"

probe "9. Kopplungspruefung Token/Zeit ausbauen" \
  "src/betriebsprofil.js" \
  'if (brauchtSekunden > werte.singleLargeTimeoutMs / 1000) {' \
  'if (false) {' \
  "src/__tests__/mistral-zeitbudget.test.js src/__tests__/rueckfall-riegel.test.js src/__tests__/betriebsprofil.test.js"

probe "10. Laufzeit-Wache wieder gegen feste Grenze messen" \
  "src/laufzeit-wache.js" \
  'const befund = bewerte(tage, werte.singleLargeTimeoutMs);' \
  'const befund = bewerte(tage, 300000);' \
  "src/__tests__/ohne-einstellungssatz.test.js src/__tests__/rueckfall-riegel.test.js src/__tests__/laufzeit-wache.test.js src/__tests__/rueckfall-riegel.test.js"

echo
if [ "$UNGEDECKT" -gt 0 ]; then
  echo "── ERGEBNIS ─────────────────────────────────────────────────"
  echo "   $UNGEDECKT von 10 Rueckbauten blieben unbemerkt."
  echo "   Diese Fixes sind ungedeckt und koennen still zurueckfallen."
  echo "   Abhilfe: je einen Riegel in rueckfall-riegel.test.js ergaenzen."
  exit 1
fi
echo "── ERGEBNIS ─────────────────────────────────────────────────"
echo "   Alle 10 Rueckbauten werden bemerkt. Die Fixes sind abgesichert."
