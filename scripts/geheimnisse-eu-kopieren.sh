#!/usr/bin/env bash
# Geheimnisse in die EU-gebundenen Secrets übertragen (09.09.2026).
#
# Hintergrund: Die vier Secrets der Functions (ADMIN_SECRET, MISTRAL_API_KEY,
# NTFY_URL, NTFY_TOPIC) waren von Google weltweit repliziert. Diese Einstellung
# lässt sich nachträglich nicht ändern, deshalb gibt es sie neu mit dem Suffix
# _EU, gebunden an europe-west1. Dieses Skript überträgt die Werte — ohne sie
# anzuzeigen, ohne sie in eine Datei zu schreiben, ohne sie zu protokollieren.
#
# Übersprungen wird jedes _EU-Secret, das schon eine aktive Version hat. So
# bleibt der NEUE Mistral-Schlüssel, den der Betreiber am 09.09.2026 direkt
# eingetragen hat, unangetastet; der alte Schlüssel wird nicht mitkopiert.
#
# Ausführen (im eigenen Terminal, mit angemeldetem gcloud-Konto):
#   sh scripts/geheimnisse-eu-kopieren.sh
# Danach: Functions-Deploy nötig (mit Freigabe). Der alte Mistral-Schlüssel
# wird im Dashboard erst gelöscht, wenn der Deploy durch ist und eine Analyse
# live erfolgreich war.
set -euo pipefail

PROJECT="malzime"
FEHLER=0

aktive_versionen() {
  gcloud secrets versions list "$1" --project="$PROJECT" --filter='state=enabled' --format='value(name)' 2>/dev/null | wc -l | tr -d ' '
}

uebertragen() {
  # $1 = alter Name, $2 = neuer Name. Der Wert läuft nur durch die Pipe.
  local alt="$1" neu="$2" vorhanden
  vorhanden=$(aktive_versionen "$neu")
  if [ "${vorhanden:-0}" -ge 1 ]; then
    echo "  --    $neu hat schon $vorhanden aktive Version(en), wird nicht überschrieben"
    return 0
  fi
  if gcloud secrets versions access latest --secret="$alt" --project="$PROJECT" \
       | gcloud secrets versions add "$neu" --project="$PROJECT" --data-file=- >/dev/null; then
    echo "  ok    $alt -> $neu (jetzt $(aktive_versionen "$neu") aktive Version)"
  else
    echo "  FEHLER bei $alt -> $neu" >&2
    FEHLER=1
  fi
}

echo "── Geheimnisse nach europe-west1 übertragen (Projekt $PROJECT) ──"
uebertragen ADMIN_SECRET ADMIN_SECRET_EU
uebertragen NTFY_URL     NTFY_URL_EU
uebertragen NTFY_TOPIC   NTFY_TOPIC_EU

MISTRAL_VERSIONEN=$(aktive_versionen MISTRAL_API_KEY_EU)
if [ "${MISTRAL_VERSIONEN:-0}" -ge 1 ]; then
  echo "  ok    MISTRAL_API_KEY_EU hat $MISTRAL_VERSIONEN aktive Version(en) (neuer Schlüssel, nicht kopiert)"
else
  echo "  FEHLT MISTRAL_API_KEY_EU hat keine Version. Neuen Schlüssel unter https://console.mistral.ai/api-keys/ anlegen und eintragen:" >&2
  echo "        printf '%s' 'DEIN_NEUER_SCHLUESSEL' | gcloud secrets versions add MISTRAL_API_KEY_EU --project=$PROJECT --data-file=-" >&2
  FEHLER=1
fi

echo
if [ "$FEHLER" = "0" ]; then
  echo "Fertig. Alle vier _EU-Secrets haben eine Version. Jetzt ist ein Functions-Deploy nötig (mit Freigabe)."
  echo "Den ALTEN Mistral-Schlüssel im Dashboard erst löschen, wenn der Deploy durch ist und eine Analyse live lief."
  exit 0
else
  echo "Nicht vollständig — siehe Meldungen oben. Kein Deploy, solange ein Secret ohne Version ist." >&2
  exit 1
fi
