#!/usr/bin/env python3
"""
pruefe-deploy-riegel.py — Sind die Riegel im Auslieferungs-Skript noch da?

WOZU: Die Rueckbauprobe am 31.08.2026 hat gezeigt, dass `scripts/deploy.sh`
von KEINEM Test abgedeckt ist. Trockenlauf, Aufraeumfalle, Stand-Bindung,
Notschalter-Bilanz — alle liessen sich entfernen, ohne dass irgendetwas rot
wurde.

Das ist die gefaehrlichste Sorte Luecke: Das Skript enthaelt genau die Riegel,
die verhindern, dass ungepruefter Code in die Produktion geht. Waeren sie weg,
faellt es erst auf, wenn es zu spaet ist.

WAS HIER GEPRUEFT WIRD: Dass jeder Riegel vorhanden ist UND an der richtigen
Stelle steht. Die Reihenfolge ist nicht kosmetisch — ein Trockenlauf nach dem
Cache-Buster liesse bei jedem Abbruch einen unsauberen Arbeitsbaum zurueck, und
eine Aufraeumfalle vor dem Cache-Buster fande nichts zum Aufraeumen.

WAS ES NICHT KANN: Es fuehrt das Skript nicht aus. Ob ein Riegel WIRKT, zeigt
nur ein echter Lauf — dafuer gibt es die Negativproben, die bei jeder Aenderung
von Hand gefahren werden (dokumentiert im jeweiligen Commit).

AUFRUF:  python3 scripts/pruefe-deploy-riegel.py
RUECKGABE: 0 = alle Riegel da, 1 = etwas fehlt, 2 = nicht messbar.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
SKRIPT = WURZEL / "scripts" / "deploy.sh"
CI = WURZEL / ".github" / "workflows" / "ci.yml"


# ─────────────────────────────────────────────────────────────────────────────
# DIE RIEGEL
#
# `muster`   — was im Skript stehen muss (regulaerer Ausdruck)
# `warum`    — was passiert, wenn er fehlt
# `vor`      — optional: dieser Riegel muss VOR dem genannten Muster stehen
# ─────────────────────────────────────────────────────────────────────────────
# UMGEBAUT 31.08.2026 — dieser Waechter prueft KEIN Verhalten mehr.
#
# Er hatte neun Regeln, die Textmuster in deploy.sh suchten. Drei Pruefer haben
# ihn unabhaengig ausgehebelt: `exit` durch `:` ersetzt, `echo` stehen gelassen
# — er meldete weiter "Alle Riegel vorhanden". Zehn realistische Rueckbauten
# blieben unbemerkt. Ein Textmuster belegt kein Verhalten.
#
# Diese neun Regeln stehen jetzt in
# functions/src/__tests__/deploy-verhalten.test.js. Dort wird deploy.sh in
# einem Wegwerf-Klon AUSGEFUEHRT, mit Attrappen fuer firebase, gh,
# verify-infrastructure und live-smoke. Acht Rueckbauproben belegen, dass jeder
# Fall rot wird, wenn der zugehoerige Riegel faellt.
#
# Was HIER bleibt, sind die zwei Pruefungen, die zu Recht Text lesen, weil es
# um Text geht: Jeder Notschalter (SKIP_*) muss in der Schlussbilanz genannt
# werden, und die concurrency-Einstellung der Pipeline.
RIEGEL_DEPLOY = []

# Die Notschalter werden AUS DEM SKRIPT gelesen, nicht hier aufgezaehlt —
# siehe die Begruendung weiter unten. Eine Liste an dieser Stelle waere genau
# die Sorte Doppelquelle, die veraltet, sobald jemand einen Schalter zufuegt.




def main():
    if not SKRIPT.exists():
        print(f"  NICHT MESSBAR: {SKRIPT} fehlt.")
        return 2

    roh = SKRIPT.read_text(encoding="utf-8")

    # BEFUND 31.08.2026 (unvorbelastetes Review): Hier wurde im ROHTEXT
    # gesucht, Kommentare eingeschlossen. Ein deploy.sh, das die Riegel nur als
    # Kommentarzeilen enthaelt und sonst nichts tut, bestand die Pruefung —
    # also genau der Zustand, den dieser Waechter aufdecken soll.
    #
    # Deshalb wird jetzt gegen den CODE geprueft: Kommentarzeilen fliegen
    # raus, bevor gesucht wird. Ein Riegel, ueber den nur geschrieben wird,
    # zaehlt nicht als Riegel.
    text = "\n".join(z for z in roh.split("\n") if not z.lstrip().startswith("#"))

    # MESSMITTEL-PROBE: Ein leeres oder abgeschnittenes Skript wuerde jede
    # Pruefung unten scheitern lassen — aber aus dem falschen Grund.
    if len(roh) < 3000:
        print(f"  NICHT MESSBAR: deploy.sh ist nur {len(roh)} Zeichen gross.")
        print("  Abgeschnitten oder ersetzt? Erst das klaeren.")
        return 2

    print("── Notschalter und Pipeline-Einstellung ──")
    print()

    # OPS-2026-08-31-17: ZUERST die eigenen Anker pruefen. Ein Anker, der nur
    # auf einer Kommentarzeile liegt, findet nach dem Kommentarfilter nichts —
    # die Regel ist dann tot und schweigt wie eine erfuellte. Genau so war die
    # Reihenfolge-Regel des Trockenlaufs von Anfang an wirkungslos.
    fehlt = []
    falsch_platziert = []
    ohne_abbruch = []

    for r in RIEGEL_DEPLOY:
        treffer = re.search(r["muster"], text, re.M)
        if not treffer:
            print(f"  FEHLT   {r['name']}")
            fehlt.append(r)
            continue

        # Reihenfolge pruefen, wo sie zaehlt
        lage = "ok   "
        if "vor" in r:
            anderer = re.search(r["vor"], text, re.M)
            if anderer and treffer.start() > anderer.start():
                lage = "FALSCHE STELLE"
                falsch_platziert.append((r, "muss VOR '" + r["vor"] + "' stehen"))
        if "nach" in r:
            anderer = re.search(r["nach"], text, re.M)
            if anderer and treffer.start() < anderer.start():
                lage = "FALSCHE STELLE"
                falsch_platziert.append((r, "muss NACH '" + r["nach"] + "' stehen"))

        print(f"  {lage:15} {r['name']}")

    print()
    print("── Taucht jeder Notschalter in der Schlussbilanz auf? ──")
    bilanz = text[text.find("UEBERSPRUNGEN=") :] if "UEBERSPRUNGEN=" in text else ""
    # Auch die Liste der Schalter kommt aus dem CODE, nicht aus einer
    # handgepflegten Aufzaehlung — sonst fehlt genau der eine, der neu
    # dazugekommen ist. (Befund 31.08.: SKIP_SATZ fehlte in beiden.)
    gefundene_schalter = sorted(set(re.findall(r"\bSKIP_[A-Z_]+\b", text)))
    if not bilanz:
        print("  NICHT MESSBAR: Die Schlussbilanz fehlt ganz.")
        return 2

    # BEFUND 31.08.2026: Hier wurde eine handgepflegte Liste durchgegangen —
    # und ausgerechnet SKIP_SATZ fehlte in ihr UND in der Schlussbilanz. Ein
    # Waechter gegen "Abschaltung mit Tarnkappe", der die eine existierende
    # Tarnkappe nicht kannte.
    #
    # Jetzt kommt die Liste aus dem Skript selbst. Sie kann nicht veralten.
    ohne_bilanz = []
    if not gefundene_schalter:
        print("  NICHT MESSBAR: kein einziger SKIP_-Schalter im Code gefunden.")
        return 2
    for s in gefundene_schalter:
        drin_in_bilanz = re.search(rf'UEBERSPRUNGEN {s}"', bilanz) is not None
        if not drin_in_bilanz:
            print(f"  FEHLT   {s} — wird nicht gemeldet, wenn er gesetzt ist")
            ohne_bilanz.append(s)
        else:
            print(f"  ok      {s}")

    # Die CI-Regel gegen parallele Laeufe
    print()
    print("── Bricht ein neuer Push den vorigen Lauf ab? ──")
    ci_fehlt = False
    if CI.exists():
        ci = CI.read_text(encoding="utf-8")
        # BEFUND 31.08.2026 (Runde 3): Hier wurde nur geprueft, OB die Woerter
        # vorkommen. `cancel-in-progress: true` haette weiter "ok" gemeldet,
        # obwohl damit ein laufender main-Durchgang abgebrochen wuerde. Jetzt
        # wird der WERT gelesen: main muss von beidem ausgenommen sein — vom
        # Abbrechen (cancel-in-progress) und von der gemeinsamen Gruppe
        # (sonst storniert ein dritter Push den zweiten).
        # Kommentarzeilen VOR der Suche entfernen: In ci.yml steht die
        # Begruendung ueber der Einstellung und nennt `cancel-in-progress:
        # false` als Beispiel. re.search nahm den ersten Treffer — den
        # Kommentar. Derselbe Fehler wie beim Riegel-Anker, gleicher Tag.
        ci_ohne_kommentar = "\n".join(
            z for z in ci.split("\n") if not z.lstrip().startswith("#")
        )
        abbruch = re.search(r"cancel-in-progress:\s*(.+)", ci_ohne_kommentar)
        gruppe = re.search(r"group:\s*>?-?\s*\n((?:\s+.+\n)+)", ci_ohne_kommentar)
        abbruch_text = abbruch.group(1).strip() if abbruch else ""
        gruppe_text = gruppe.group(1) if gruppe else ""
        if not abbruch:
            print("  FEHLT   cancel-in-progress ist nicht gesetzt —")
            print("          bis zu fuenf Pruefdurchgaenge laufen gleichzeitig")
            ci_fehlt = True
        elif "refs/heads/main" not in abbruch_text:
            print(f"  FEHLT   cancel-in-progress nimmt main nicht aus: {abbruch_text}")
            print("          Ein abgebrochener main-Lauf blockiert die Auslieferung.")
            ci_fehlt = True
        elif "github.sha" not in gruppe_text:
            print("  FEHLT   die Gruppe unterscheidet main-Laeufe nicht je Commit —")
            print("          ein dritter Push storniert dann den zweiten wartenden.")
            ci_fehlt = True
        else:
            print("  ok      main ist vom Abbrechen und von der Gruppe ausgenommen")
    else:
        print("  NICHT MESSBAR: ci.yml fehlt")
        return 2

    print()
    anzahl = len(fehlt) + len(falsch_platziert) + len(ohne_abbruch) + len(ohne_bilanz) + (1 if ci_fehlt else 0)
    if anzahl == 0:
        print("  ERGEBNIS: Notschalter vollstaendig gemeldet, Pipeline-Einstellung ok.")
        print("  (Die Riegel SELBST prueft deploy-verhalten.test.js — ausgefuehrt, nicht gelesen.)")
        return 0

    print(f"  ERGEBNIS: {anzahl} Befund(e).")
    print()
    for r in fehlt:
        print(f"  ▸ FEHLT: {r['name']}")
        print(f"     {r['warum']}")
        print()
    for r in ohne_abbruch:
        print(f"  ▸ MELDUNG OHNE ABBRUCH: {r['name']}")
        print("     Der Meldungstext steht da, aber kein `exit` dahinter — der Riegel")
        print("     meldet und liefert trotzdem aus.")
        print()
    for r, wo in falsch_platziert:
        print(f"  ▸ FALSCHE STELLE: {r['name']} — {wo}")
        print(f"     {r['warum']}")
        print()
    for s in ohne_bilanz:
        print(f"  ▸ {s} fehlt in der Schlussbilanz.")
        print("     Ein uebersprungener Riegel muss am Ende genannt werden — sonst")
        print("     sieht der Lauf gruen aus, obwohl eine Pruefung ausgefallen ist.")
        print()
    return 1


if __name__ == "__main__":
    sys.exit(main())
