#!/usr/bin/env python3
"""
pruefe-mitzieher.py — "Wenn du X aenderst, gehoert Y mitgezogen."

WOZU: Am 30.08.2026 wurde ein neues Pflichtfeld (`queueRatePerSekunde`) in den
Einstellungssatz aufgenommen. Es musste an SIEBEN Stellen nachgezogen werden.
Zwei davon wurden vergessen und erst vom Testlauf gefunden — also spaet, und
nur weil es zufaellig einen Test gab, der es merkt.

Christoph dazu: "Das sollst du zukuenftig doch selber machen, ohne dass ich
dich darauf hinweisen muss. Das muss ja doch klar sein."

Er hat recht, und es ist kein Sorgfaltsproblem: Nirgends stand, was
zusammengehoert. Dieses Skript schreibt es auf und prueft es.

WIE ES PRUEFT: Es sieht sich die geaenderten Dateien an (gegen origin/main oder
einen genannten Vergleichsstand) und meldet, wenn eine Aenderung ihre
Begleiter nicht mitgebracht hat.

AUFRUF:
    python3 scripts/pruefe-mitzieher.py            gegen origin/main
    python3 scripts/pruefe-mitzieher.py HEAD~3     gegen einen anderen Stand

RUECKGABE: 0 = nichts vergessen, 1 = etwas fehlt, 2 = nicht messbar.
"""

import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent


def lauf(*befehl):
    """Fuehrt einen Befehl aus und gibt die Ausgabe zurueck. None bei Fehler."""
    try:
        e = subprocess.run(befehl, cwd=WURZEL, capture_output=True, text=True, timeout=60)
        return e.stdout if e.returncode == 0 else None
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# DIE REGELN
#
# Jede Regel beschreibt eine Kopplung, die sonst nur in jemandes Kopf steht.
# `ausloeser`  — welche Datei und welches Muster darin
# `begleiter`  — was dann auch angefasst gehoert
# `warum`      — was passiert, wenn man es vergisst (das ist der wichtige Teil)
# ─────────────────────────────────────────────────────────────────────────────
REGELN = [
    {
        "name": "Neues Pflichtfeld im Einstellungssatz",
        "ausloeser_datei": "functions/src/betriebsprofil.js",
        "ausloeser_muster": r"^\+\s+([a-zA-Z]+):\s*\{\s*min:",
        "begleiter": [
            "functions/src/test-satz.js",
            "functions/src/produktiv-satz.js",
            "docs/BETRIEBSPROFILE.md",
            "functions/src/__tests__/wirkung-jeder-wert.test.js",
        ],
        "warum": (
            "Ein Pflichtfeld ohne Wert macht den Satz ungueltig — dann laeuft KEINE\n"
            "     Analyse mehr. Ausserdem prueft satz-gegen-doku.test.js die Doku gegen\n"
            "     den Produktivsatz; fehlt das Feld dort, ist die Suite rot."
        ),
    },
    {
        "name": "Neue Cloud Function",
        "ausloeser_datei": "functions/src/index.js",
        "ausloeser_muster": r"^\+exports\.([a-zA-Z]+)\s*=",
        "begleiter": ["scripts/verify-infrastructure.sh"],
        "warum": (
            "Der Infrastruktur-Waechter prueft, ob JEDE Function im Filter der\n"
            "     Fehler-Alarmierung steht. Eine neue ohne Eintrag stoppt die naechste\n"
            "     Auslieferung — am 29.08. genau so passiert."
        ),
    },
    {
        "name": "Neue Seite unter public/",
        "ausloeser_datei": r"public/[a-z-]+\.html",
        "ausloeser_muster": None,  # das blosse Anlegen zaehlt
        "nur_neue": True,
        "begleiter": ["scripts/deploy.sh"],
        "warum": (
            "Die Cache-Kennung wird ueber alle HTML-Dateien geschrieben. Eine Seite,\n"
            "     die der Suchpfad nicht erfasst, friert auf einem alten Stilblatt ein\n"
            "     — am 17.08. und noch einmal mit den englischen Seiten passiert."
        ),
    },
    {
        "name": "Neuer Betriebswert im Code statt im Satz",
        "ausloeser_datei": "functions/src/config.js",
        "ausloeser_muster": r"^\+const [A-Z_]+ = \d",
        "begleiter": [],
        "warum": (
            "Zahlen gehoeren in den Einstellungssatz, nicht in den Code. Bleibt sie\n"
            "     hier, braucht jede Aenderung eine Auslieferung. Ausnahme nur mit der\n"
            "     Begruendung BLEIBT IM CODE direkt daneben — das prueft\n"
            "     pruefe-doppelte-werte.py."
        ),
    },
]


def main():
    vergleich = sys.argv[1] if len(sys.argv) > 1 else "origin/main"

    print("── Wenn du X aenderst, gehoert Y mitgezogen ──")
    print(f"   Vergleich gegen: {vergleich}")
    print()

    # Was wurde geaendert?
    #
    # BEFUND aus der eigenen Negativprobe (31.08.2026): Hier stand
    # `diff vergleich...HEAD`. Das vergleicht nur COMMITTETE Staende — der
    # Waechter schwieg also genau dann, wenn man ihn braucht: waehrend man
    # gerade an der Aenderung sitzt und noch nichts committet hat.
    #
    # Ohne die Probe waere er als "gruen" durchgegangen, ohne je etwas
    # gemessen zu haben. Jetzt zaehlt beides: was seit dem Vergleichsstand
    # committet wurde UND was im Arbeitsbaum liegt.
    teile = []
    committet = lauf("git", "diff", "--name-only", f"{vergleich}...HEAD")
    if committet:
        teile += [z for z in committet.split("\n") if z.strip()]
    # Ohne die drei Punkte: Arbeitsbaum gegen den Vergleichsstand.
    arbeitsbaum = lauf("git", "diff", "--name-only", vergleich)
    if arbeitsbaum:
        teile += [z for z in arbeitsbaum.split("\n") if z.strip()]
    # Auch noch nicht verfolgte Dateien zaehlen — eine neue Seite ist neu.
    neue = lauf("git", "ls-files", "--others", "--exclude-standard")
    if neue:
        teile += [z for z in neue.split("\n") if z.strip()]

    if committet is None and arbeitsbaum is None:
        print("  NICHT MESSBAR: git diff liefert nichts.")
        print("  Ein leeres Ergebnis ist zuerst ein Verdacht gegen die Messung.")
        return 2

    geaendert = sorted(set(teile))
    if not geaendert:
        print("  Keine Aenderungen gefunden — nichts zu pruefen.")
        return 0

    print(f"  Geaenderte Dateien: {len(geaendert)}")
    print()

    diff = (lauf("git", "diff", f"{vergleich}...HEAD") or "") + "\n" + (lauf("git", "diff", vergleich) or "")

    funde = []

    for regel in REGELN:
        muster_datei = regel["ausloeser_datei"]
        betroffen = [d for d in geaendert if re.fullmatch(muster_datei, d) or d == muster_datei]
        if not betroffen:
            continue

        # Wurde das Muster wirklich hinzugefuegt?
        if regel["ausloeser_muster"]:
            treffer = re.findall(regel["ausloeser_muster"], diff, re.M)
            if not treffer:
                continue
            was = ", ".join(sorted(set(treffer))[:4])
        else:
            was = ", ".join(betroffen[:3])

        fehlende = [b for b in regel["begleiter"] if b not in geaendert]
        if not fehlende:
            print(f"  ok    {regel['name']}: alle Begleiter mitgezogen")
            continue

        funde.append((regel, was, fehlende))

    print()
    if not funde:
        print("  ERGEBNIS: Nichts vergessen.")
        return 0

    print(f"  ERGEBNIS: {len(funde)} Kopplung(en) nicht vollstaendig nachgezogen.")
    print()
    for regel, was, fehlende in funde:
        print(f"  ▸ {regel['name']}")
        print(f"     Geaendert:  {was}")
        print(f"     Es fehlt:   {', '.join(fehlende)}")
        print(f"     Warum:      {regel['warum']}")
        print()
    print("  Wenn eine Meldung nicht zutrifft, gehoert die Regel angepasst —")
    print("  nicht ignoriert. Sie steht in scripts/pruefe-mitzieher.py.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
