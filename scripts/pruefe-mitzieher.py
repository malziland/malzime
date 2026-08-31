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


def _hunk_fuer(diff, dateien):
    """Gibt nur die Diff-Abschnitte der genannten Dateien zurueck.

    Ohne diese Eingrenzung wuerde ein Ausloeser-Muster im ganzen Diff gesucht:
    Eine passende Zeile in einer voellig anderen Datei loeste dann eine Regel
    aus, die mit ihr nichts zu tun hat (Befund 31.08.2026).
    """
    abschnitte = []
    aktuell = None
    for zeile in diff.split("\n"):
        if zeile.startswith("diff --git "):
            aktuell = any(d in zeile for d in dateien)
        if aktuell:
            abschnitte.append(zeile)
    return "\n".join(abschnitte)


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
        "ausloeser_datei": r"public/(?:[a-z]+/)?[a-z0-9-]+\.html",
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
        # BEFUND 31.08.2026: Diese Regel hatte eine LEERE Begleiter-Liste und
        # meldete deshalb immer "ok" — sie konnte per Konstruktion nie
        # anschlagen. Ein Waechter, der nicht rot werden kann, ist Zierrat.
        #
        # Zustaendig fuer diesen Fall ist ohnehin pruefe-doppelte-werte.py: Er
        # geht vom Code aus und verlangt fuer jede Zahlenkonstante entweder
        # einen Platz im Einstellungssatz oder die Begruendung BLEIBT IM CODE.
        # Die Regel hier waere eine schwaechere Doppelung gewesen.
        "name": "Neuer Betriebswert im Code statt im Satz",
        "ausloeser_datei": "functions/src/config.js",
        "ausloeser_muster": r"^\+const [A-Z_]+ = \d",
        "abgeschaltet": "geprueft von pruefe-doppelte-werte.py",
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
    # BEFUND 31.08.2026 (unvorbelastetes Review), drei Fehler auf einmal:
    #
    #   · `git diff <ref>` OHNE die drei Punkte zeigt auch, was seit dem
    #     Abzweig auf `main` passiert ist. Ein PR, der hinter main liegt, bekam
    #     so fremde Dateien in seine Liste — und lief in Fehlalarme.
    #   · Neue Dateien wurden nicht von geaenderten unterschieden. Die Regel
    #     "Neue Seite unter public/" feuerte deshalb auf JEDE Beruehrung einer
    #     HTML-Datei — und haette jeden Cache-Buster-PR blockiert, der nach
    #     JEDEM Deploy anfaellt. Die Auslieferungskette haette gestanden.
    #   · Ein erfolgreicher Diff mit leerer Ausgabe galt als "nichts zu
    #     pruefen". Genau im main-Lauf, an den die Stand-Bindung des Deploys
    #     gebunden ist, mass der Waechter damit gar nichts.
    committet = lauf("git", "diff", "--name-only", f"{vergleich}...HEAD")
    arbeitsbaum = lauf("git", "diff", "--name-only", "HEAD")
    neue_dateien = lauf("git", "ls-files", "--others", "--exclude-standard")
    # Welche Dateien sind seit dem Vergleichsstand NEU entstanden? Nur fuer die
    # gilt eine Regel mit `nur_neue`.
    hinzugefuegt = lauf("git", "diff", "--name-only", "--diff-filter=A", f"{vergleich}...HEAD")

    if committet is None and arbeitsbaum is None:
        print("  NICHT MESSBAR: git diff liefert nichts — kein Vergleichsstand?")
        print("  Ein leeres Ergebnis ist zuerst ein Verdacht gegen die Messung.")
        return 2

    def zeilen(t):
        return [z for z in (t or "").split("\n") if z.strip()]

    geaendert = sorted(set(zeilen(committet) + zeilen(arbeitsbaum) + zeilen(neue_dateien)))
    neu_entstanden = set(zeilen(hinzugefuegt) + zeilen(neue_dateien))

    # BEFUND 31.08.2026: "nicht messbar" griff nur, wenn `git diff`
    # FEHLSCHLUG. Der haeufige Fall ist ein erfolgreicher Diff mit LEERER
    # Ausgabe — etwa beim Push auf `main`, wo HEAD == origin/main ist. Dann
    # meldete der Waechter "nichts zu pruefen" und Rueckgabewert 0, ohne je
    # etwas gemessen zu haben. Ausgerechnet im main-Lauf, an den die
    # Stand-Bindung des Deploys gebunden ist.
    #
    # Jetzt wird der Unterschied benannt: "es gibt nichts zu pruefen, weil der
    # Vergleichsstand IDENTISCH ist" ist ein anderer Zustand als "ich habe
    # geprueft und nichts gefunden".
    if not geaendert:
        kopf = lauf("git", "rev-parse", "HEAD")
        ziel = lauf("git", "rev-parse", vergleich)
        gleich = kopf and ziel and kopf.strip() == ziel.strip()
        if gleich:
            print(f"  Der Vergleichsstand ({vergleich}) IST der aktuelle Stand.")
            print("  Es gibt keine Aenderung zu pruefen — das ist kein Bestehen,")
            print("  sondern die Feststellung, dass hier nichts zu messen war.")
            print()
            print("  (Beim Lauf auf main ist das der Normalfall. Geprueft wird im")
            print("   Pull Request, wo es einen Unterschied gibt.)")
            return 0
        print("  NICHT MESSBAR: Der Vergleich lieferte keine einzige Datei,")
        print(f"  obwohl HEAD und {vergleich} verschieden sind.")
        print("  Ein leeres Ergebnis ist zuerst ein Verdacht gegen die Messung —")
        print("  hier stimmt etwas mit dem Vergleichsstand nicht.")
        return 2
    print(f"  Geaenderte Dateien: {len(geaendert)}")
    print()

    diff = (lauf("git", "diff", f"{vergleich}...HEAD") or "") + "\n" + (lauf("git", "diff", "HEAD") or "")

    funde = []

    for regel in REGELN:
        # Eine ausdruecklich abgeschaltete Regel wird GENANNT, nicht
        # stillschweigend uebersprungen. Sonst weiss niemand, dass sie da ist.
        if regel.get("abgeschaltet"):
            print(f"  ---   {regel['name']}: abgeschaltet ({regel['abgeschaltet']})")
            continue

        muster_datei = regel["ausloeser_datei"]
        betroffen = [d for d in geaendert if re.fullmatch(muster_datei, d) or d == muster_datei]
        if not betroffen:
            continue

        # BEFUND 31.08.2026: `nur_neue` stand in der Regel und wurde NIRGENDS
        # gelesen. Die Regel "Neue Seite unter public/" feuerte deshalb auf
        # jede Beruehrung einer HTML-Datei — und haette jeden Cache-Buster-PR
        # blockiert, der nach jedem Deploy anfaellt.
        if regel.get("nur_neue"):
            betroffen = [d for d in betroffen if d in neu_entstanden]
            if not betroffen:
                continue

        # Wurde das Muster wirklich hinzugefuegt?
        #
        # BEFUND 31.08.2026: Gesucht wurde im GANZEN Diff. Wird die
        # Ausloeser-Datei aus anderem Grund beruehrt und steht irgendwo sonst
        # eine passende Zeile, entstand ein Fehlalarm. Jetzt wird nur der
        # Abschnitt dieser Datei durchsucht.
        if regel["ausloeser_muster"]:
            abschnitt = _hunk_fuer(diff, betroffen)
            treffer = re.findall(regel["ausloeser_muster"], abschnitt, re.M)
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
