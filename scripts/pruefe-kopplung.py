#!/usr/bin/env python3
"""
pruefe-kopplung.py — Waechst wieder zusammen, was getrennt gehoert?

WOZU: Am 30.08.2026 hat ein Umbau des Einstellungssatzes 39 Fundstellen
erzeugt. Nicht weil der Code schlecht waere, sondern weil eine Aenderung
dieser Art weit ausstrahlt: `mistral.js` war auf 1681 Zeilen gewachsen und
vermischte vier Aufgaben, und an `betriebsprofil.js` haengen 15 Module.

Aufteilen allein hilft nicht dauerhaft — Dateien wachsen zurueck, wenn niemand
hinsieht. Dieses Skript sieht hin.

WAS ES ANSIEHT: Programmdateien unter functions/src und public/js, dazu die
oberste Ebene von public/ (Einstiegs-Skript, Stylesheet, Hauptseite) und die
eigenen Skripte unter scripts/ — siehe NACHSUCHE. Es misst DATEIEN, nicht
einzelne Funktionen. Fuer Funktionen haelt seit 07.10.2026 die Stil-Pruefung
eine eigene Sperrklinke (hoechste Verzweigungszahl und laengste Funktion, in
eslint.config.mjs und functions/eslint.config.js).

WAS ES NICHT TUT: Es verbietet nichts. Es meldet, wenn eine Datei ueber ihre
festgehaltene Groesse waechst, und verlangt dann eine Entscheidung: teilen oder
die Grenze bewusst anheben. Beides ist in Ordnung — unbemerktes Wachsen nicht.

DIE GRENZEN sind der GEMESSENE Stand vom 31.08.2026, aufgerundet. Sie sind
kein Ideal, sondern eine Sperrklinke: von hier aus nur noch abwaerts.

AUFRUF:
    python3 scripts/pruefe-kopplung.py             pruefen
    python3 scripts/pruefe-kopplung.py --stand     heutige Werte anzeigen
    python3 scripts/pruefe-kopplung.py --bestand   die vorhandenen Testdateien als
                                                   Bestandsliste ausgeben (zum Nachziehen von
                                                   scripts/testdateien-bestand.txt)

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
    # BEFUND 01.09.2026 (Runde 6): Diese vier fand die Nachsuche erst, seit sie
    # dieselben Baeume abdeckt wie die Liste (vorher nur functions/src/*.js,
    # ohne Unterordner und ohne public/js/). Die Grenzen sind der gemessene
    # Stand plus rund 5 Prozent.
    #
    # Die beiden Prompt-Dateien sind bewusst gross: Sie enthalten die Texte,
    # nicht Logik. Eine Grenze haben sie trotzdem — waechst dort Code hinein,
    # soll es auffallen.
    "functions/src/locales/de/prompts.js": 1190,
    "functions/src/locales/en/prompts.js": 1140,
    "public/js/realitaets-check.js": 460,
    "public/js/sprachumschalter.js": 680,
    # BEFUND 31.08.2026 (Runde 3): Diese vier standen in KEINER Grenze und
    # waren damit von der Sperrklinke nicht erfasst. Die Grenzen sind der
    # gemessene Stand plus rund 5 Prozent Luft — wie bei allen anderen auch.
    "functions/src/betriebsprofil.js": 440,
    "functions/src/handle-enqueue.js": 455,  # 01.09.2026: +15 fuer den
    # configMissing-Riegel VOR der Ratenbegrenzung. Die Simulation zeigte,
    # dass ohne Satz `checkRateLimit` wirft und der Einlass mit HTTP 500
    # antwortet statt mit dem freundlichen 503. Der Riegel ist kein neuer
    # Aufgabenbereich, sondern eine Vorbedingung — Teilen wuerde die Datei
    # nicht verstaendlicher machen, nur die Reihenfolge verstecken.
    # 01.10.2026: +5 fuer "ein Alarm je gescheiterter Analyse" — die zwei
    # Fehlerwege ohne Auftrag (Speicher/Datenbank weg, unerwarteter 5xx)
    # melden sich selbst (je eine Zeile plus Import); die Meldung selbst
    # liegt in jobs.js, hier steht nur der Aufruf.
    "functions/src/json-repair.js": 585,
    "functions/src/mistral-mock.js": 465,
    # Der grosse Brocken. Nach drei Schnitten (Antwort-Parser, Live-Text,
    # HTTP-Schicht) von 1681 auf 1090 Zeilen gefallen. Die Grenze sinkt mit
    # jedem Schnitt mit — sonst waere die Sperrklinke nach dem Aufteilen
    # wirkungslos und die Datei koennte unbemerkt zurueckwachsen.
    # Nach VIER Schnitten von 1681 auf 696 Zeilen. Uebrig ist der
    # Ein-Aufruf-Weg, der taegliche Normalfall.
    #
    # ANGEHOBEN 01.10.2026 von 760 auf 790 (Workshop 01.10.: Verbindungsabriss
    # zu Mistral): Die Behandlung selbst — Erkennen, Markieren, Grund ohne
    # Adressen, Neuversuch, Rettbarkeit — steht im NEUEN verbindungsfehler.js
    # (Grenze unten). Hier bleiben nur die Aufrufstellen im Ein-Aufruf-Weg:
    # der Neuversuch um den ersten Aufruf, die Warnung beim ersten Abriss und
    # das Feld `ursache` in zwei Fehlerzeilen. Sie herauszuloesen hiesse, den
    # Ablauf des Normalfalls zu verstecken.
    "functions/src/mistral.js": 790,
    # Abgetrennt 01.10.2026 — sonst waere die Grenze oben umgehbar.
    # 150 -> 170 noch am selben Tag: Die Positivliste der zulaessigen
    # Fehlertexte (Befund R-03, Datenschutz) ersetzt die Maskierung nach
    # Mustern und ist eine Liste, keine Logik.
    "functions/src/verbindungsfehler.js": 170,
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
    # Der Netzzugriff des Frontends. 10.09.2026: Wake-Lock und
    # Auftragsgedaechtnis ausgelagert (js/wake-lock.js, js/auftrag-speicher.js),
    # 1079 -> 952 Zeilen; die Grenze sinkt mit, sonst waechst die Datei
    # unbemerkt zurueck.
    "public/js/api.js": 1000,
    "public/js/render.js": 830,
    # ANGEHOBEN 11.09.2026 von 790 auf 975 (gemessen 928 plus rund 5 Prozent):
    # Der Stundenzaehler zaehlt seitdem jeden Auftrag genau einmal — Marke je
    # Einlass, Nachtrag, Nachlauf-Riegel. Das gehoert in DIESE Datei: Einlass
    # (checkAndIncrement) und Freigabe (releaseHourlySlot) teilen sich den
    # Zustand der offenen Nachlaeufe; getrennt muesste er ueber eine
    # Modulgrenze gereicht werden. Der naechste Schnitt, wenn die Datei wieder
    # waechst: Wartungsmodus und Realitaets-Check gehoeren am wenigsten dazu.
    "functions/src/counter.js": 975,
    "functions/src/jobs.js": 770,
    # Nach zwei Schnitten (Helfer, Analyse-Wege) von 679 auf 285 Zeilen.
    "functions/src/handle-process-job.js": 320,
    # Die beiden Analyse-Wege.
    "functions/src/job-pipelines.js": 400,
    # Die kleinen Entscheidungen, die alle Wege brauchen.
    "functions/src/job-helfer.js": 150,
    # Die Sprachdateien sind Inhalt, kein Code — sie duerfen wachsen.
    # Deshalb stehen prompts.js hier bewusst NICHT.
    #
    # TEST-2026-10-03-44: Bis 07.10.2026 sah der Waechter nur `.js` unter
    # functions/src und public/js. Das Einstiegs-Skript der Website, das
    # Stylesheet, die Hauptseite und die eigenen Skripte der Auslieferung
    # durften beliebig wachsen (Probe: public/app.js von 432 auf 1032 Zeilen,
    # Rueckgabewert 0). Die folgenden Grenzen sind der gemessene Stand vom
    # 07.10.2026 plus rund 5 Prozent — eine Sperrklinke, kein Urteil: Lang sind
    # diese Dateien heute, weil sie viel erklaeren.
    "public/app.js": 455,
    "public/styles.css": 4960,
    "public/index.html": 620,
    "scripts/deploy.sh": 1410,
    "scripts/pruefe-deploy-riegel.py": 1480,
    "scripts/verify-infrastructure.sh": 915,
    "scripts/selbstpruefung-waechter.sh": 720,
    "scripts/pruefe-fremd-meldungen.mjs": 605,
    "scripts/pruefe-mutationen.mjs": 600,
    "scripts/pruefe-live.sh": 580,
    # 07.10.2026: +40 fuer die Eintraege unten und die laengere Liste der
    # unverzichtbaren Tests — Daten, keine Logik.
    "scripts/pruefe-kopplung.py": 560,
    # 07.10.2026: Die Aufteilungen der Behebung nach dem Audit vom 03.10.2026
    # haben neue Dateien erzeugt, die in keiner Grenze standen — genau das
    # Schlupfloch, das der Kommentar oben beschreibt (aus einer grossen Datei
    # werden mehrere kleine, die danach unbemerkt wachsen). Dazu drei Dateien,
    # die ohne Grenze nahe an der 400er-Schwelle lagen, und die Wochen-
    # Erinnerung, die eine zweite Zusage bekommen hat. Gemessener Stand plus
    # rund 5 Prozent.
    "functions/src/betriebsprofil-kopplung.js": 150,
    "functions/src/meldungs-annahme.js": 115,
    "functions/src/erinnerungs-waechter.js": 108,
    "functions/src/warteschlangen-rechnung.js": 91,
    "functions/src/analyse-ausgang.js": 83,
    "functions/src/oeffentliche-huelle.js": 57,
    "functions/src/ruecknahme.js": 45,
    "functions/src/index.js": 385,
    "functions/src/handle-reap.js": 357,
    "functions/src/handle-job-status.js": 354,
    "functions/src/handle-erinnerung.js": 273,
    "public/js/auftrag-abfrage.js": 160,
    "public/js/netz-hilfen.js": 78,
    "public/js/foto-vorschau.js": 60,
}

# Wo nach Dateien OHNE Grenze gesucht wird (TEST-2026-10-03-44): Ordner,
# Dateiendungen, und ob die Unterordner dazugehoeren. Wer hier eine Datei ueber
# SCHWELLE Zeilen anlegt, bekommt sie gemeldet, bis sie eine Grenze hat.
#
# Bewusst NICHT dabei: Tests (`__tests__`, e2e/), Fremdcode (public/lib/,
# scripts/pruefungen/ — vendoriert), Sprachdateien und die Rechtsseiten unter
# public/ (Text, ihr Umfang folgt dem Inhalt; nur die Hauptseite index.html
# steht oben in der Liste).
NACHSUCHE = (
    ("functions/src", (".js",), True),
    ("public/js", (".js",), True),
    ("public", (".js", ".css"), False),
    ("scripts", (".sh", ".py", ".mjs", ".js"), False),
)

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


# ─────────────────────────────────────────────────────────────────────────────
# DER BESTAND DER TESTDATEIEN (TEST-2026-10-04-28)
#
# Die Liste UNVERZICHTBAR in main() nennt die Testdateien, die fuer einen ganzen
# Bereich der einzige Nachweis sind. Jede andere liess sich loeschen, ohne dass
# ein Waechter anschlug — die Suite wird dann kleiner und bleibt gruen.
#
# Deshalb steht jede Testdatei mit Namen in scripts/testdateien-bestand.txt.
# Verglichen wird in beide Richtungen: Eine Datei aus dem Bestand, die es nicht
# mehr gibt, ist ein Fund — und eine Testdatei, die nicht im Bestand steht,
# auch (sonst waere jede neue Datei wieder ungeschuetzt). Wer eine Testdatei
# bewusst loescht, streicht ihre Zeile; die Loeschung steht dann zweimal im Diff.
# ─────────────────────────────────────────────────────────────────────────────
BESTAND = WURZEL / "scripts" / "testdateien-bestand.txt"
TEST_BEREICHE = ("functions/src/__tests__", "public/__tests__", "e2e")
BESTAND_KOPF = """\
# Bestand der Testdateien. scripts/pruefe-kopplung.py vergleicht diese Liste mit
# den Ordnern functions/src/__tests__, public/__tests__ und e2e — in beide
# Richtungen (TEST-2026-10-04-28).
#
#   Neue Testdatei:             Zeile eintragen.
#   Bewusst geloeschte Datei:   Zeile streichen.
#   Ganze Liste neu schreiben:  python3 scripts/pruefe-kopplung.py --bestand > scripts/testdateien-bestand.txt
"""


def testdateien_vorhanden():
    """Alle `*.test.js` in den drei Test-Bereichen, als Pfade ab der Projektwurzel."""
    funde = set()
    for bereich in TEST_BEREICHE:
        for datei in (WURZEL / bereich).rglob("*.test.js"):
            pfad = datei.relative_to(WURZEL).as_posix()
            if "/node_modules/" not in pfad:
                funde.add(pfad)
    return sorted(funde)


def testdateien_bestand():
    """Die Zeilen der Bestandsliste; `None`, wenn es die Datei nicht gibt."""
    if not BESTAND.exists():
        return None
    zeilen_ = (z.strip() for z in BESTAND.read_text(encoding="utf-8").split("\n"))
    return [z for z in zeilen_ if z and not z.startswith("#")]


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

    if "--bestand" in sys.argv:
        # Nur ausgeben, nichts lesen: Der uebliche Aufruf leitet in die
        # Bestandsdatei um, und die ist dann schon geleert.
        vorhanden = testdateien_vorhanden()
        if not vorhanden:
            print("NICHT MESSBAR: keine einzige Testdatei gefunden.", file=sys.stderr)
            return 2
        sys.stdout.write(BESTAND_KOPF + "\n".join(vorhanden) + "\n")
        return 0

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
    # Seit 04.10.2026 dazu die Testdateien, die fuer je einen Riegel oder eine
    # Zusage der einzige Nachweis sind: der Vertrag der Pipeline-Dateien, die
    # oeffentliche Nachpruefung, der Umfang des Server-Pakets, die Schalter
    # fuer lokale Laeufe — und die Tests hinter den Datenschutz- und
    # Kinderschutz-Zusagen (keine IP-Adresse im Protokoll, Loeschfristen,
    # Riegel gegen Testlaeufe an echtem Speicher und echter Warteschlange,
    # Sperrliste, Alterslesung, Verbotssatz der KI-Anweisung, Beispielbilder
    # ohne Abfrage nach aussen).
    # Seit 05.10.2026 dazu: der Test des Infrastruktur-Waechters (Alarmregeln,
    # Benachrichtigungs-Server), die Weitergabe des Alters an den
    # Kinderschutz-Filter, der Test des Nachtlaufs fuer mitgelieferte
    # Bibliotheken und die zwei Modultests der Beispielbilder (woran ein
    # Beispielbild erkannt wird; ob Karte, Adresse und Quellenangabe zu den
    # Ortsdaten der Bilddateien passen). Ebenso: dass auch die Werbung des
    # zweiten KI-Aufrufs durch den Kinderschutz-Filter laeuft, dass kein
    # fester Eintrag der Tier-Profile einer waere, den der Filter streicht,
    # und dass jeder Fehlerweg der Analyse die schon gezeigten Karten abraeumt.
    # Seit 07.10.2026 dazu die Tests hinter dem, was die zweite Auslieferung
    # der Audit-Behebung zusagt: Loeschen auch ohne Einstellungssatz und nach
    # einem Absturz, Speichern vor der Antwort, Abmelden nur mit Abhol-Ticket,
    # Freigabe an einer Stelle, gepackte Anfragen, die Sperren der Tests gegen
    # echte Dienste, die Kopplungsregeln des Einstellungssatzes, die Zahlen
    # der oeffentlichen Seiten gegen den Satz, Geraeteangaben und Auftrag ohne
    # Zufallsnummer gegen den Datenschutztext, die Erinnerung an die
    # Barrierefreiheits-Pruefung, die Ueberlast-Entscheidung, die Zeitgrenze
    # des Antwort-Rumpfs, die Namens-Regel der KI-Anweisung und die Abfolgen
    # im Browser.
    UNVERZICHTBAR = [
        "functions/src/__tests__/deploy-verhalten.test.js",
        "functions/src/__tests__/pipeline-vertrag-script.test.js",
        "functions/src/__tests__/pruefe-live-verhalten.test.js",
        "functions/src/__tests__/server-paket.test.js",
        "functions/src/__tests__/lokale-schalter.test.js",
        "functions/src/__tests__/keine-ip-im-protokoll.test.js",
        "functions/src/__tests__/jobs-fristen-groesse.test.js",
        "functions/src/__tests__/queue-storage-emulator-riegel.test.js",
        "functions/src/__tests__/kapazitaets-wache-emulator-riegel.test.js",
        "functions/src/__tests__/minor-safety-woerter.test.js",
        "functions/src/__tests__/alters-platzhalter.test.js",
        "functions/src/__tests__/prompt-verbot-themen.test.js",
        "functions/src/__tests__/verify-infrastructure-script.test.js",
        "functions/src/__tests__/job-pipelines-profile.test.js",
        "functions/src/__tests__/fremd-meldungen-script.test.js",
        "functions/src/__tests__/job-pipelines-zweite-werbung.test.js",
        "functions/src/__tests__/animal.test.js",
        "public/__tests__/queue-livetext.test.js",
        "public/__tests__/beispielbild-ort.test.js",
        "public/__tests__/beispielbild-karten.test.js",
        "e2e/beispielbild-ohne-ortsabfrage.test.js",
        "functions/src/__tests__/ueberlast-entscheidung.test.js",
        "functions/src/__tests__/mistral-rumpf-zeitgrenze.test.js",
        "functions/src/__tests__/keine-personennamen-regel.test.js",
        "functions/src/__tests__/handle-process-job-priv002.test.js",
        "functions/src/__tests__/handle-job-status-abmelden.test.js",
        "functions/src/__tests__/aufraeumer-loescht-ohne-satz.test.js",
        "functions/src/__tests__/foto-nach-absturz.test.js",
        "functions/src/__tests__/schreiben-vor-der-antwort.test.js",
        "functions/src/__tests__/meldung-am-zustand.test.js",
        "functions/src/__tests__/gepackte-anfragen.test.js",
        "functions/src/__tests__/freigabe-ueber-die-hilfe.test.js",
        "functions/src/__tests__/jest-sperre.test.js",
        "functions/src/__tests__/einstiegspunkt-betriebswerte.test.js",
        "functions/src/__tests__/betriebsprofil-kopplung.test.js",
        "functions/src/__tests__/oeffentliche-zahlen-gegen-satz.test.js",
        "functions/src/__tests__/fehlermeldung-geraeteangaben.test.js",
        "functions/src/__tests__/auftrag-ohne-zufallsnummer.test.js",
        "functions/src/__tests__/erinnerung-barrierefreiheit.test.js",
        "public/__tests__/analyse-ausgaenge.test.js",
        "public/__tests__/geraeteangaben-deckung.test.js",
        "public/__tests__/datenschutz-deckung.test.js",
        "e2e/abfolgen.test.js",
        "functions/src/__tests__/dateilisten-vollstaendig.test.js",
        "functions/src/__tests__/doku-namen-gegen-quelltext.test.js",
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

    bestand = testdateien_bestand()
    vorhanden = testdateien_vorhanden()
    if not bestand or not vorhanden:
        # Leere Liste oder leere Suche: Dann laege nicht alles im Bestand,
        # sondern das Messmittel waere blind.
        print("  NICHT MESSBAR: " + (
            "scripts/testdateien-bestand.txt fehlt oder ist leer."
            if not bestand else "in den Test-Ordnern liegt keine einzige *.test.js."))
        print()
        return 2
    geloescht = sorted(set(bestand) - set(vorhanden))
    nicht_eingetragen = sorted(set(vorhanden) - set(bestand))
    if geloescht or nicht_eingetragen:
        if geloescht:
            print("  TESTDATEI FEHLT — steht im Bestand, gibt es aber nicht mehr:")
            for d in geloescht:
                print(f"    {d}")
            print("  Versehen? Wiederherstellen. Absicht (oder umbenannt)? Die Zeile in")
            print("  scripts/testdateien-bestand.txt streichen.")
        if nicht_eingetragen:
            print("  TESTDATEI NICHT IM BESTAND — vorhanden, aber nicht eingetragen:")
            for d in nicht_eingetragen:
                print(f"    {d}")
            print("  In scripts/testdateien-bestand.txt eintragen; sonst fiele ihr")
            print("  Verschwinden spaeter niemandem auf.")
        print()
        return 1
    print(f"  Testdateien: {len(vorhanden)} vorhanden, alle im Bestand.")
    print()

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
    # BEFUND 01.09.2026 (Runde 6, G-7): Gesucht wurde nur in
    # `functions/src/*.js` — die Grenzenliste enthaelt aber auch drei Dateien
    # unter `public/js/`, und Unterordner fehlten ganz. Gemessen: eine Datei
    # mit 901 Zeilen unter `public/js/` -> "Alles innerhalb der Grenzen";
    # dieselbe Datei unter `functions/src/` -> rot. Die Suche deckt jetzt
    # dieselben Baeume ab wie die Liste, samt Unterordnern.
    # TEST-2026-10-03-44: Die Bereiche stehen jetzt ausdruecklich in NACHSUCHE
    # (vorher: die Elternordner der gelisteten Dateien, nur `*.js`). Ein Ordner
    # aus der Liste, den es nicht gibt, ist ein Messproblem — sonst faende die
    # Suche dort still nichts.
    kandidaten = []
    for ordner, endungen, mit_unterordnern in NACHSUCHE:
        basis = WURZEL / ordner
        if not basis.is_dir():
            fehlend.append(ordner + "/")
            continue
        for datei in (basis.rglob("*") if mit_unterordnern else basis.glob("*")):
            if datei.is_file() and datei.name.endswith(endungen):
                kandidaten.append(datei)
    for pfad_abs in sorted(set(kandidaten)):
        pfad = str(pfad_abs.relative_to(WURZEL))
        if "/node_modules/" in pfad or "/__tests__/" in pfad:
            continue
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

    # BEFUND 01.09.2026 (Runde 6, G-13): Hier stand nur die Zahl der
    # ueberschrittenen Grenzen. Bei einer Datei OHNE Grenze meldete das Skript
    # Rueckgabewert 1 und dazu "0 Grenze(n) ueberschritten" — wer nur die
    # Meldung liest, haelt das fuer bestanden.
    teile = []
    if funde:
        teile.append(f"{len(funde)} Grenze(n) ueberschritten")
    if ungelistet:
        teile.append(f"{len(ungelistet)} Datei(en) ohne Grenze")
    if fehlend:
        teile.append(f"{len(fehlend)} gelistete Datei(en) fehlen")
    print(f"  ERGEBNIS: {', '.join(teile) if teile else 'Befund ohne Zaehlung'}.")
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
