#!/bin/sh
#
# changelog-oberste-version.sh — welcher Abschnitt steht im CHANGELOG ganz oben?
#
# Herkunft: OPS-2026-08-12-30, gefunden bei der Sanierung des TIEF-Audits.
# release.yml holte sich die "oberste Version" mit `grep -m1` nach dem Muster
# x.y.z — und uebersah dabei, dass darueber ein Abschnitt [Unveroeffentlicht]
# stehen kann. Genau das ist in diesem Projekt der dokumentierte Normalzustand
# zwischen zwei Deploys. Die erste Nummer weiter unten ist dann eine BEREITS
# AUSGELIEFERTE. Sobald sich die oberste Ueberschrift aenderte (etwa weil eine
# vorschnell vergebene Nummer zurueckgenommen wurde), haette der Waechter den
# Tag dieser alten Nummer auf den neuen Stand umgehaengt: die OPS-002-Falle vom
# 2026-08-10, nur durch eine andere Tuer.
#
# Deshalb entscheidet hier die ERSTE Zeile der Form "## [...]", gleich welchen
# Inhalts — nicht die erste, die zufaellig wie eine Version aussieht.
#
# Aufruf:  changelog-oberste-version.sh [DATEI]     (ohne DATEI: von stdin)
# Ausgabe: der Abschnittsname ohne Klammern, auf stdout
#
# Exit 0:  stabile Version x.y.z          -> ein Release ist faellig
# Exit 1:  ein anderer Abschnitt          -> kein Release faellig, kein Fehler
# Exit 2:  keine Ueberschrift auswertbar  -> Messung gescheitert. Das ist
#          ausdruecklich KEIN "nichts zu tun": Ein leeres Ergebnis ist zuerst
#          ein Verdacht gegen das Messmittel, nicht gegen die Datei.

set -eu

QUELLE="${1:--}"
if [ "$QUELLE" = "-" ]; then
  INHALT="$(cat)"
elif [ -r "$QUELLE" ]; then
  INHALT="$(cat "$QUELLE")"
else
  echo "FEHLER: '$QUELLE' ist nicht lesbar." >&2
  exit 2
fi

KOPF="$(printf '%s\n' "$INHALT" | grep -m1 -oE '^## \[[^]]+\]' || true)"
if [ -z "$KOPF" ]; then
  echo "FEHLER: keine Abschnitts-Ueberschrift der Form '## [...]' gefunden." >&2
  exit 2
fi

NAME="$(printf '%s' "$KOPF" | sed -E 's/^## \[//; s/\]$//')"
printf '%s\n' "$NAME"

# Bewusst streng: x.y.z und sonst nichts. Ein Vorabstand wie 3.1.0-rc1 ist
# keine stabile Version und loest keinen Release aus.
if printf '%s' "$NAME" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  exit 0
fi
exit 1
