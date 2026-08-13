#!/usr/bin/env bash
# malziME Live-Smoke — vier kostenfreie Proben gegen die echte Produktion.
#
# Läuft automatisch am Ende von scripts/deploy.sh (Notschalter SKIP_SMOKE=1)
# und kann jederzeit direkt gestartet werden. Jeder Deploy endet damit mit
# einem Live-Beweis statt mit Hoffnung.
#
# Alle vier Proben enden VOR dem KI-Aufruf und VOR dem Stundenzähler:
# sie kosten nichts, verändern nichts und verfälschen keine Statistik
# (Rezept dokumentiert seit 2026-07-29, Live-Smoke-Regel: immer den Pfad
# messen, den der echte Client nimmt — JSON+Base64 über malzi.me/api/…).
#
# Exit-Codes: 0 = alle Proben wie erwartet · 1 = Abweichung

set -u
BASIS="https://malzi.me"
FEHLER=0

probe() { # $1 Beschreibung, $2 erwarteter HTTP-Code, $3 Methode, $4 Pfad, $5 Body (leer = GET ohne Body)
  local IST
  if [ -n "$5" ]; then
    IST=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 -X "$3" "$BASIS$4" -H "Content-Type: application/json" -d "$5")
  else
    IST=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$BASIS$4")
  fi
  if [ "$IST" = "$2" ]; then
    printf "  \033[32m✓\033[0m %s: HTTP %s\n" "$1" "$IST"
  else
    printf "  \033[31m✗\033[0m %s: SOLL HTTP %s, IST HTTP %s\n" "$1" "$2" "$IST"
    FEHLER=1
  fi
}

echo "Live-Smoke gegen $BASIS (kostenfrei, ohne Zustandsänderung)"

# 1) Kompletter Request-Weg: Body ankommen, Base64 dekodieren, Validierung
#    erreichen — BMP steht nicht auf der Erlaubt-Liste und MUSS 400 geben.
probe "Upload-Weg (BMP → Ablehnung)" 400 POST "/api/enqueue" '{"imageBase64":"aGFsbG8gbWFsemlNRQ==","mimeType":"image/bmp","lang":"de"}'

#    Zusatz-Schärfe: die Ablehnung muss die ECHTE Validierungs-Meldung sein
#    (nicht irgendein anderer 400er).
ANTWORT=$(curl -s --max-time 20 -X POST "$BASIS/api/enqueue" -H "Content-Type: application/json" -d '{"imageBase64":"aGFsbG8gbWFsemlNRQ==","mimeType":"image/bmp","lang":"de"}')
case "$ANTWORT" in
  *"Invalid file type"*) printf "  \033[32m✓\033[0m Ablehnungs-Text: echte Dateityp-Validierung\n" ;;
  *) printf "  \033[31m✗\033[0m Ablehnungs-Text unerwartet: %.80s\n" "$ANTWORT"; FEHLER=1 ;;
esac

# 2) Bot-Schutz: gefülltes Honeypot-Feld MUSS 403 geben.
probe "Honeypot" 403 POST "/api/enqueue" '{"imageBase64":"aGFsbG8=","mimeType":"image/jpeg","lang":"de","website":"bot"}'

# 3) Admin-Schutz: ungültige Nonce MUSS 403 geben (keine Mutation möglich).
probe "Admin-Zugriffsschutz" 403 POST "/api/admin/boost" '{"nonce":"ungueltig"}'

# 4) Lebenszeichen: öffentliche Stats MUSS 200 geben.
probe "Stats-Endpunkt" 200 GET "/api/stats" ""

# 5) OPS-2026-08-13-42/K3: Kennungs-Rückmessung. Die vier Proben oben galten
#    schon VOR dem Deploy — ein wirkungsloser Hosting-Deploy (Teil-Upload,
#    falsches Ziel, CDN) wäre von ihnen nicht zu unterscheiden. Wird eine
#    erwartete Buster-Version übergeben (deploy.sh tut das nur bei Hosting im
#    Ziel), liest diese Probe den AUSGELIEFERTEN Buster von / zurück und
#    vergleicht. So misst der Smoke die Wirkung, nicht nur die Erreichbarkeit
#    (KERN 10: den ausgelieferten Stand auslesen, nicht "deployt" behaupten).
ERWARTETE_VERSION="${1:-}"
if [ -n "$ERWARTETE_VERSION" ]; then
  LIVE_BUSTER=$(curl -s --max-time 20 "$BASIS/" | grep -o 'styles\.css?v=[0-9]*' | head -1 | grep -o '[0-9]*$' || true)
  if [ -z "$LIVE_BUSTER" ]; then
    printf "  \033[31m✗\033[0m Kennung: Buster auf / nicht lesbar — kein bestandener Beweis\n"
    FEHLER=1
  elif [ "$LIVE_BUSTER" = "$ERWARTETE_VERSION" ]; then
    printf "  \033[32m✓\033[0m Kennung: ausgelieferter Buster %s == erwartet\n" "$LIVE_BUSTER"
  else
    printf "  \033[31m✗\033[0m Kennung: ausgeliefert %s, erwartet %s — Hosting-Deploy wirkungslos?\n" "$LIVE_BUSTER" "$ERWARTETE_VERSION"
    FEHLER=1
  fi
fi

if [ "$FEHLER" = "0" ]; then
  echo "ERGEBNIS: Live-Smoke grün — alle Proben wie erwartet."
  exit 0
else
  echo "ERGEBNIS: Live-Smoke ROT — Abweichung an der Produktion! Störungs-Rezepte: docs/RUNBOOK.md." >&2
  exit 1
fi
