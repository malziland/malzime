#!/usr/bin/env python3
"""Findet Wartezeiten in E2E-Tests, die groesser sind als das Zeitlimit des Tests.

WARUM ES DIESE PRUEFUNG GIBT (Fund vom 2026-08-21):

`playwright.config.js` setzt ein Zeitlimit von 30 Sekunden je Test. Wartet ein
Test laenger auf ein Element — etwa `waitForSelector(..., { timeout: 45000 })` —,
dann greift das Zeitlimit des Tests VORHER. Die laengere Geduld ist wirkungslos.

Genau das war passiert: In `ansagen.test.js` stand seit einer frueheren Sanierung
der Kommentar "45 s statt 20: Auf dem Firefox-Laeufer der CI reichten 20 s nicht".
Die Absicht war richtig, die Wirkung gleich null — der Test starb weiter nach 30
Sekunden. Am 21.08. hat er die Auslieferung blockiert.

Das Tueckische daran: Es sieht im Quelltext nach Sorgfalt aus. Wer die Stelle
liest, denkt, das Problem sei behoben.

DIE BEHEBUNG ist nicht, das globale Limit anzuheben — das verlaengert jeden
haengenden Test. Der betroffene Test bekommt `test.slow()` (verdreifacht sein
Limit) oder ein ausdrueckliches `test.setTimeout(...)`.

RUECKGABEWERTE:
  0 = keine tote Geduld
  1 = Befund
  2 = Messproblem (Konfiguration nicht lesbar, keine Testdateien)
"""

import os
import re
import sys
import glob

# Playwright verdreifacht das Limit bei test.slow().
SLOW_FAKTOR = 3


def test_limit_aus_konfiguration(pfad="playwright.config.js"):
    try:
        inhalt = open(pfad, encoding="utf-8").read()
    except OSError:
        return None
    treffer = re.search(r"^\s*timeout:\s*(\d+)", inhalt, re.M)
    return int(treffer.group(1)) if treffer else None


def ohne_kommentare(inhalt):
    """Entfernt Kommentare, behaelt aber die Zeilenzahl.

    Ohne das zaehlt ein AUSKOMMENTIERTES `test.slow()` als vorhanden und tarnt
    einen echten Befund — dieselbe Krankheit, die diese Pruefung finden soll.
    Aufgefallen 2026-08-21 in der eigenen Rueckbauprobe: Die Pruefung meldete
    gruen, obwohl der Fix zurueckgedreht war.

    Zeilenumbrueche bleiben stehen, damit die gemeldeten Zeilennummern stimmen.

    BEFUND 01.09.2026 (Selbstpruefung): Die erste Fassung ersetzte Kommentare
    per Regex — und traf damit auch `//` in Zeichenketten. Ein `page.goto(
    "http://localhost:8081")` blendete den REST DER ZEILE aus. Gemessen ueber
    alle E2E-Dateien: 984 Zeilen echten Codes galten als Kommentar. Der
    Waechter war damit auf einem Fuenftel der Suite blind, und keine seiner
    Meldungen sagte das.

    Aufgefallen ist es erst, als fuer diesen Waechter eine Sabotage-Probe
    gebaut wurde: Eine Wartezeit von 99 Sekunden in einem Test mit
    30-Sekunden-Grenze — er meldete gruen.

    Jetzt wird zeichenweise gelesen, mit Zustand fuer Zeichenketten.
    """
    ergebnis = []
    i = 0
    laenge = len(inhalt)
    anfuehrung = None
    while i < laenge:
        c = inhalt[i]
        naechstes = inhalt[i + 1] if i + 1 < laenge else ""
        if anfuehrung:
            ergebnis.append(c)
            if c == "\\" and i + 1 < laenge:
                ergebnis.append(naechstes)
                i += 2
                continue
            if c == anfuehrung:
                anfuehrung = None
            i += 1
            continue
        if c in "\"'`":
            anfuehrung = c
            ergebnis.append(c)
            i += 1
            continue
        # BEFUND 01.09.2026 (Pruefrunde 8, M-P2-3): Regex-Literale fehlten.
        # Ein `/["']/` setzte den Zeichenketten-Zustand und liess ihn bis
        # Dateiende haengen — ab dort war der Waechter wieder blind, genau die
        # Fehlerform, gegen die der Umbau angetreten war, nur an einer anderen
        # Zeichenklasse. Ein `/` beginnt ein Regex, wenn davor ein Operator
        # oder eine oeffnende Klammer steht (nicht nach Wert oder Klammer-zu).
        if c == "/" and naechstes not in ("/", "*"):
            vorher = "".join(ergebnis).rstrip()
            letztes = vorher[-1] if vorher else "("
            if letztes in "(,=:[!&|?{};+-*%<>~^" or vorher.endswith(("return", "typeof", "case")):
                ende = i + 1
                in_klasse = False
                while ende < laenge:
                    z = inhalt[ende]
                    if z == "\\":
                        ende += 2
                        continue
                    if z == "[":
                        in_klasse = True
                    elif z == "]":
                        in_klasse = False
                    elif z == "/" and not in_klasse:
                        ende += 1
                        break
                    elif z == "\n":
                        break  # unbalanciert: kein Regex
                    ende += 1
                ergebnis.append(inhalt[i:ende])
                i = ende
                continue
        if c == "/" and naechstes == "/":
            while i < laenge and inhalt[i] != "\n":
                ergebnis.append(" ")
                i += 1
            continue
        if c == "/" and naechstes == "*":
            ende = inhalt.find("*/", i + 2)
            ende = laenge if ende == -1 else ende + 2
            for zeichen in inhalt[i:ende]:
                ergebnis.append("\n" if zeichen == "\n" else " ")
            i = ende
            continue
        ergebnis.append(c)
        i += 1
    return "".join(ergebnis)


def bloecke(inhalt):
    """Zerlegt eine Datei grob in Test-Bloecke: ab `test(` bis zum naechsten `test(`.

    Absichtlich einfach gehalten. Eine echte Zerlegung braeuchte einen Parser;
    fuer die Frage "steht in DIESEM Test ein zu grosser Timeout und fehlt ihm
    test.slow()" reicht der Abstand zwischen zwei Test-Anfaengen.
    """
    # NUR echte Testanfaenge. `test.slow(` und `test.setTimeout(` sind KEINE —
    # ein erster Anlauf hat sie mitgezaehlt, dadurch die Bloecke falsch
    # geschnitten und ausgerechnet den Test uebersehen, der die Auslieferung
    # blockiert hat.
    anfaenge = [
        m.start()
        for m in re.finditer(r"^\s*test(?:\.(?:only|skip|fixme|describe))?\s*\(", inhalt, re.M)
    ]
    for i, start in enumerate(anfaenge):
        ende = anfaenge[i + 1] if i + 1 < len(anfaenge) else len(inhalt)
        yield start, inhalt[start:ende]


def main():
    grenze = test_limit_aus_konfiguration()
    if grenze is None:
        print("MESSPROBLEM: Zeitlimit aus playwright.config.js nicht lesbar.")
        return 2

    dateien = sorted(glob.glob("e2e/*.test.js"))
    if not dateien:
        print("MESSPROBLEM: keine E2E-Testdateien gefunden — falsches Verzeichnis?")
        return 2

    befunde = []
    geprueft = 0

    for datei in dateien:
        try:
            inhalt = open(datei, encoding="utf-8").read()
        except OSError as fehler:
            print(f"MESSPROBLEM: {datei} nicht lesbar — {fehler}")
            return 2

        inhalt = ohne_kommentare(inhalt)

        # Datei-weit gilt nur, was VOR dem ersten Test steht. Ein `test.slow()`
        # INNERHALB eines Tests gilt ausschliesslich dort — der erste Anlauf hat
        # es faelschlich auf die ganze Datei bezogen und deshalb einen echten
        # Befund durchgewinkt. Ein Waechter, der Ausfaelle als Erfolg tarnt, ist
        # schlimmer als einer, der laermt.
        erster_test = re.search(r"^\s*test(?:\.(?:only|skip|fixme))?\s*\(", inhalt, re.M)
        kopf = inhalt[: erster_test.start()] if erster_test else inhalt
        datei_slow = bool(re.search(r"\btest\.(slow|setTimeout)\s*\(", kopf))

        for versatz, block in bloecke(inhalt):
            geprueft += 1
            hat_slow = bool(re.search(r"\btest\.slow\s*\(", block))
            hat_eigenes = re.search(r"\btest\.setTimeout\s*\(\s*(\d+)", block)

            if hat_eigenes:
                erlaubt = int(hat_eigenes.group(1))
            elif hat_slow:
                erlaubt = grenze * SLOW_FAKTOR
            else:
                erlaubt = grenze

            # BEFUND 01.09.2026 (Selbstpruefung): Bis hier wurde NUR nach der
            # Option `timeout: <zahl>` gesucht. Eine feste Wartezeit
            # `waitForTimeout(99000)` in einem Test mit 30-s-Grenze macht den
            # Test genauso tot — der Waechter sah sie nicht. Aufgefallen ist es
            # erst, als eine Sabotage-Probe fuer diesen Waechter gebaut wurde:
            # Er meldete gruen, obwohl eine 99-Sekunden-Wartezeit im Test stand.
            for m in re.finditer(r"(?:timeout:\s*|waitForTimeout\s*\(\s*)(\d+)", block):
                wert = int(m.group(1))
                if wert <= erlaubt:
                    continue
                if datei_slow and not hat_slow and wert <= grenze * SLOW_FAKTOR:
                    continue
                zeile = inhalt[: versatz + m.start()].count("\n") + 1
                name = re.search(r'test(?:\.\w+)?\s*\(\s*[`"\']([^`"\']{0,70})', block)
                befunde.append((datei, zeile, wert, erlaubt, name.group(1) if name else "?"))

    print(f"Geprüft: {geprueft} Tests in {len(dateien)} Dateien. Zeitlimit je Test: {grenze} ms.")

    for datei, zeile, wert, erlaubt, name in befunde:
        print(f"\nTOTE GEDULD  {datei}:{zeile}")
        print(f"       Test    : {name}")
        print(f"       wartet  : {wert} ms")
        print(f"       darf nur: {erlaubt} ms — das Zeitlimit des Tests greift vorher.")

    if befunde:
        print(
            f"\nERGEBNIS: {len(befunde)} wirkungslose Wartezeit(en).\n"
            "Eine Wartezeit über dem Zeitlimit des Tests ändert nichts — der Test stirbt\n"
            "vorher. Sie sieht im Quelltext nur nach Sorgfalt aus. Behebung: `test.slow()`\n"
            "im betroffenen Test (verdreifacht sein Limit), nicht das globale Limit anheben."
        )
        return 1

    print("ERGEBNIS: grün — keine Wartezeit übersteigt das Zeitlimit ihres Tests.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
