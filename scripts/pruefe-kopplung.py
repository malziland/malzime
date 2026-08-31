#!/usr/bin/env python3
"""
pruefe-kopplung.py — Waechst wieder zusammen, was getrennt gehoert?

WOZU: Am 30.08.2026 hat ein Umbau des Einstellungssatzes 39 Fundstellen
erzeugt. Nicht weil der Code schlecht waere, sondern weil eine Aenderung
dieser Art weit ausstrahlt: `mistral.js` war auf 1681 Zeilen gewachsen und
vermischte vier Aufgaben, und an `betriebsprofil.js` haengen 15 Module.

Aufteilen allein hilft nicht dauerhaft — Dateien wachsen zurueck, wenn niemand
hinsieht. Dieses Skript sieht hin.

WAS ES NICHT TUT: Es verbietet nichts. Es meldet, wenn eine Datei ueber ihre
festgehaltene Groesse waechst, und verlangt dann eine Entscheidung: teilen oder
die Grenze bewusst anheben. Beides ist in Ordnung — unbemerktes Wachsen nicht.

DIE GRENZEN sind der GEMESSENE Stand vom 31.08.2026, aufgerundet. Sie sind
kein Ideal, sondern eine Sperrklinke: von hier aus nur noch abwaerts.

AUFRUF:
    python3 scripts/pruefe-kopplung.py           pruefen
    python3 scripts/pruefe-kopplung.py --stand   heutige Werte anzeigen

RUECKGABE: 0 = alles innerhalb der Grenzen, 1 = etwas gewachsen, 2 = nicht messbar.
"""

import glob
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# ─────────────────────────────────────────────────────────────────────────────
# DIE SPERRKLINKEN
#
# Gemessen am 31.08.2026 nach dem ersten Schnitt an mistral.js. Wer eine Grenze
# anhebt, schreibt daneben, warum — sonst ist die Sperrklinke ein Ornament.
# ─────────────────────────────────────────────────────────────────────────────
# BEFUND 31.08.2026 (unvorbelastetes Review), zwei Punkte:
#
#   · Die abgetrennte Haelfte stand in KEINER Grenze. Eine Verletzung in
#     mistral.js liesse sich also "beheben", indem man Code in die ungezaehlte
#     Datei schiebt — die Sperrklinke waere umgehbar.
#   · Die Grenzen lagen 3 bis 12 Zeilen ueber dem Ist-Stand. In einem Projekt,
#     das zu jeder Aenderung eine ausfuehrliche Begruendung schreibt, reisst
#     der Pflicht-Check dann an der DOKUMENTATION, nicht an der Kopplung — und
#     die vorgeschlagene Abhilfe fuegt weitere Zeilen hinzu.
#
# Deshalb: jede Datei in der Liste, und rund 5 % Luft. Das laesst Raum fuer
# Begruendungen und schlaegt trotzdem an, bevor eine Datei wirklich waechst.
ZEILEN_GRENZEN = {
    # BEFUND 31.08.2026 (Runde 3): Diese vier standen in KEINER Grenze und
    # waren damit von der Sperrklinke nicht erfasst. Die Grenzen sind der
    # gemessene Stand plus rund 5 Prozent Luft — wie bei allen anderen auch.
    "functions/src/betriebsprofil.js": 440,
    "functions/src/handle-enqueue.js": 435,
    "functions/src/json-repair.js": 585,
    "functions/src/mistral-mock.js": 465,
    # Der grosse Brocken. Nach drei Schnitten (Antwort-Parser, Live-Text,
    # HTTP-Schicht) von 1681 auf 1090 Zeilen gefallen. Die Grenze sinkt mit
    # jedem Schnitt mit — sonst waere die Sperrklinke nach dem Aufteilen
    # wirkungslos und die Datei koennte unbemerkt zurueckwachsen.
    # Nach VIER Schnitten von 1681 auf 696 Zeilen. Uebrig ist der
    # Ein-Aufruf-Weg, der taegliche Normalfall.
    "functions/src/mistral.js": 760,
    # Der Rueckfall-Weg mit drei Aufrufen, vierter Schnitt.
    "functions/src/mistral-drei-call.js": 420,
    # Der Netzzugriff, dritter Schnitt.
    "functions/src/mistral-http.js": 450,
    # Die abgetrennte Haelfte — sonst waere die Grenze oben umgehbar.
    #
    # ANGEHOBEN 31.08.2026 von 260 auf 340, zweiter Schnitt: Die Live-Text- und
    # Karten-Auswertung ist dazugekommen (extrahiereKarten, extrahiereLiveText,
    # REQUIRED_CARDS und die vier Schluessel-Konstanten). Sie stand in
    # mistral.js, ist aber Parsing — sie liest aus dem angefangenen JSON, was
    # schon lesbar ist, und beruehrt kein Netz.
    #
    # Das ist die zulaessige Antwort auf eine Grenzverletzung: anheben UND
    # begruenden. Der Gewinn steht daneben — mistral.js ist im selben Schritt
    # von 1681 auf 1438 Zeilen gefallen.
    "functions/src/mistral-antwort.js": 340,
    # Die Live-Anzeige im Browser. Noch nicht angefasst.
    "public/js/live-anzeige.js": 1370,
    # Der Netzzugriff des Frontends.
    "public/js/api.js": 1080,
    "public/js/render.js": 830,
    "functions/src/counter.js": 790,
    "functions/src/jobs.js": 770,
    # Nach zwei Schnitten (Helfer, Analyse-Wege) von 679 auf 279 Zeilen.
    "functions/src/handle-process-job.js": 320,
    # Die beiden Analyse-Wege.
    "functions/src/job-pipelines.js": 400,
    # Die kleinen Entscheidungen, die alle Wege brauchen.
    "functions/src/job-helfer.js": 150,
    # Die Sprachdateien sind Inhalt, kein Code — sie duerfen wachsen.
    # Deshalb stehen prompts.js hier bewusst NICHT.
}

# Wie viele Module duerfen an einem einzelnen haengen? Ueber dieser Zahl wird
# eine Aenderung dort teuer, weil sie ueberallhin ausstrahlt.
ABHAENGIGKEITS_GRENZEN = {
    # ANGEHOBEN 31.08.2026 von 15 auf 17: Die Aufteilung von mistral.js und
    # handle-process-job.js hat fuenf neue Dateien erzeugt, und jede holt ihre
    # Betriebswerte selbst aus dem Einstellungssatz — statt sie durch drei
    # Schichten gereicht zu bekommen.
    #
    # Das ist die gewollte Richtung: Wer einen Wert braucht, fragt danach. Die
    # Alternative waere ein Durchreichen, das bei jeder Aenderung drei Stellen
    # beruehrt — genau die Kopplung, gegen die dieser Waechter da ist.
    #
    # Wenn diese Zahl weiter steigt, ist die Frage nicht "hoeher setzen",
    # sondern: Braucht es einen gemeinsamen Zugang, der die Werte einmal holt
    # und weitergibt? Ab etwa 20 lohnt sich das.
    "betriebsprofil": 17,
    # ANGEHOBEN 31.08.2026 von 12 auf 14: Die Aufteilung von mistral.js hat
    # drei neue Dateien erzeugt, und jede holt ihre Adressen und Modellnamen
    # selbst aus config — statt sie durchgereicht zu bekommen. Das ist die
    # richtige Richtung (kein Durchreichen durch drei Schichten), erhoeht aber
    # die Zahl der Abhaengigen. Der Gewinn steht daneben: mistral.js ist von
    # 1681 auf 696 Zeilen gefallen.
    "config": 14,
    "db": 10,  # heute 9
}


def zeilen(pfad):
    p = WURZEL / pfad
    if not p.exists():
        return None
    return len(p.read_text(encoding="utf-8").split("\n"))


def haengen_an(modul):
    """Wie viele Module unter functions/src requiren dieses Modul?"""
    treffer = 0
    for f in (WURZEL / "functions" / "src").glob("*.js"):
        if f.stem == modul:
            continue
        if re.search(rf'require\("\./{re.escape(modul)}"\)', f.read_text(encoding="utf-8")):
            treffer += 1
    return treffer


def main():
    nur_stand = "--stand" in sys.argv

    print("── Waechst wieder zusammen, was getrennt gehoert? ──")
    print()

    funde = []
    fehlend = []
    ungelistet = []

    # BEFUND 31.08.2026 (Runde 4, F-4): `deploy-verhalten.test.js` ist der
    # EINZIGE Nachweis, dass die acht Riegel der Auslieferung wirklich
    # greifen — und liess sich spurlos loeschen, ohne dass ein Waechter
    # anschlug. Gemessen: Datei entfernt, fuenf Waechter alle rc 0.
    # Diese Dateien duerfen nicht verschwinden, ohne dass es auffaellt.
    UNVERZICHTBAR = [
        "functions/src/__tests__/deploy-verhalten.test.js",
        "functions/jest.setup.js",
        "scripts/selbstpruefung-waechter.sh",
    ]
    verschwunden = [d for d in UNVERZICHTBAR if not (WURZEL / d).exists()]
    if verschwunden:
        print("  UNVERZICHTBARE PRUEFUNG FEHLT:")
        for d in verschwunden:
            print(f"    {d}")
        print("  Ohne sie gibt es fuer einen ganzen Bereich keinen Nachweis mehr.")
        print()
        return 1

    print("  Dateigroessen:")
    for pfad, grenze in sorted(ZEILEN_GRENZEN.items()):
        ist = zeilen(pfad)
        if ist is None:
            fehlend.append(pfad)
            print(f"    FEHLT   {pfad}")
            continue
        rest = grenze - ist
        marke = "ok   " if ist <= grenze else "ZU GROSS"
        print(f"    {marke:8} {ist:5} / {grenze:5}  {pfad}  ({rest:+d})")
        if ist > grenze:
            funde.append((pfad, ist, grenze, "Zeilen"))

    # BEFUND 31.08.2026 (Runde 3, von zwei Pruefern): Die Sperrklinke deckte nur
    # die Dateien in der Liste. Wer 900 Zeilen in eine NEUE, ungelistete Datei
    # schob, bekam "Alles innerhalb der Grenzen" — genau das Schlupfloch, das
    # der Kommentar oben fuer geschlossen erklaerte. Geschlossen war es nur fuer
    # die damals bekannten Haelften.
    SCHWELLE = 400
    # BEFUND 31.08.2026 (Runde 5, H-10): Hier stand ein RELATIVER Pfad, waehrend
    # alles andere ueber WURZEL geht. Aus einem anderen Verzeichnis heraus fand
    # der glob nichts und der Waechter meldete "Alles innerhalb der Grenzen" —
    # gemessen: aus der Projektwurzel rc 1, aus /tmp rc 0, bei gleichem Inhalt.
    for pfad_abs in sorted((WURZEL / "functions" / "src").glob("*.js")):
        pfad = str(pfad_abs.relative_to(WURZEL))
        if pfad in ZEILEN_GRENZEN:
            continue
        ist = zeilen(pfad)
        if ist is not None and ist > SCHWELLE:
            ungelistet.append((pfad, ist))
    if ungelistet:
        print()
        print(f"  Ohne Grenze, aber groesser als {SCHWELLE} Zeilen:")
        for pfad, ist in ungelistet:
            print(f"    OHNE GRENZE {ist:5}         {pfad}")

    print()
    print("  Wie viele Module haengen an einem einzelnen:")
    for modul, grenze in sorted(ABHAENGIGKEITS_GRENZEN.items()):
        ist = haengen_an(modul)
        marke = "ok   " if ist <= grenze else "ZU VIELE"
        print(f"    {marke:8} {ist:5} / {grenze:5}  {modul}")
        if ist > grenze:
            funde.append((modul, ist, grenze, "Module"))

    # MESSMITTEL-PROBE: Eine Datei, die es nicht mehr gibt, macht die Pruefung
    # stillschweigend wertlos. Ein leeres Ergebnis waere dann kein Bestehen.
    if fehlend:
        print()
        print(f"  NICHT MESSBAR: {len(fehlend)} Datei(en) aus der Liste gibt es nicht mehr.")
        print("  Umbenannt oder geloescht? Dann gehoert die Liste angepasst.")
        for f in fehlend:
            print(f"    {f}")
        return 2

    print()
    if nur_stand:
        print("  (Nur angezeigt — keine Bewertung.)")
        return 0

    if not funde and not ungelistet:
        print("  ERGEBNIS: Alles innerhalb der Grenzen.")
        return 0

    print(f"  ERGEBNIS: {len(funde)} Grenze(n) ueberschritten.")
    print()
    for was, ist, grenze, art in funde:
        print(f"  ▸ {was}: {ist} {art} (Grenze {grenze})")
    print()
    print("  Zwei zulaessige Antworten:")
    print("    1. Teilen — die Aufgabe herausloesen, die am wenigsten dazugehoert.")
    print("    2. Die Grenze in scripts/pruefe-kopplung.py anheben UND daneben")
    print("       schreiben, warum das hier richtig ist.")
    print()
    print("  Nicht zulaessig: die Meldung ignorieren. Dann waechst es weiter,")
    print("  bis der naechste Querschnitts-Umbau 39 Fundstellen erzeugt.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
