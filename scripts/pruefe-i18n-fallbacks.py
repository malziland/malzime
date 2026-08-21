#!/usr/bin/env python3
"""Prueft, ob der im HTML stehende Text mit der Sprachdatei uebereinstimmt.

WARUM ES DIESE PRUEFUNG GIBT (Fund vom 2026-08-21):

Jedes uebersetzbare Element traegt `data-i18n="schluessel"` und dazwischen einen
fest im HTML stehenden Text. Dieser Text ist kein Platzhalter, sondern das, was
Besucher SEHEN, bis die Sprachdatei geladen und angewendet ist — und das, was sie
DAUERHAFT sehen, wenn sie gar nicht laedt.

Genau dort war der Limit-Hinweis der Startseite auseinandergelaufen: In der
Sprachdatei stand die ueberarbeitete Fassung ("Kurze Pause." samt Hinweis auf die
Eigenfinanzierung), im HTML noch die alte, haertere ("Stundenlimit erreicht").
Vier Absaetze waren betroffen. Gemerkt hat es niemand, weil der Limit-Hinweis nur
bei Andrang erscheint — also ausgerechnet im Workshop.

WAS SIE PRUEFT

Fuer jedes Element mit `data-i18n`: Steht der Schluessel in der Sprachdatei, und
stimmt der sichtbare Text mit ihr ueberein? Verglichen wird der reine Text ohne
innere Auszeichnung, mit zusammengefassten Leerzeichen — `<abbr>IP</abbr>-Adressen`
und `IP-Adressen` gelten also als gleich.

Deutsche Seiten werden gegen de.json geprueft, alles unter public/en/ gegen en.json.

RUECKGABEWERTE, absichtlich getrennt (die Lehre aus frueheren Waechtern: ein
kaputtes Messmittel darf nicht wie ein gruener Lauf aussehen):
  0 = keine Abweichung
  1 = Abweichung gefunden (echter Befund)
  2 = Messproblem (Datei fehlt, JSON kaputt, kein Element gefunden)
"""

import json
import re
import sys
import glob
from html.parser import HTMLParser

LEERE_TAGS = {"br", "img", "input", "hr", "meta", "link", "source", "wbr"}


class TextSammler(HTMLParser):
    """Sammelt je data-i18n-Element den sichtbaren Text samt Zeilennummer.

    Ein Regex reicht hier nicht: Die Elemente enthalten weitere Tags (<abbr>,
    <strong>) und teils gleichnamige verschachtelte. Ein erster Anlauf mit
    Regex lieferte am 21.08. vier Scheinbefunde, weil `.*?` ueber das
    schliessende Tag hinauslief.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.treffer = []
        self._stapel = []  # offene Elemente: (tag, schluessel|None, zeile, teile)

    def handle_starttag(self, tag, attrs):
        if tag in LEERE_TAGS:
            return
        merkmale = dict(attrs)
        schluessel = merkmale.get("data-i18n")
        # Sammelt nur, wenn wir in einem data-i18n-Element sind oder eines beginnt
        self._stapel.append((tag, schluessel, self.getpos()[0], []))

    def handle_startendtag(self, tag, attrs):
        pass  # selbstschliessend: kein Text

    def handle_data(self, daten):
        for eintrag in self._stapel:
            eintrag[3].append(daten)

    def handle_endtag(self, tag):
        # Bis zum passenden offenen Tag zurueckrollen (unsauberes HTML toleriert)
        while self._stapel:
            offen = self._stapel.pop()
            if offen[1]:
                self.treffer.append((offen[1], "".join(offen[3]), offen[2]))
            if offen[0] == tag:
                break


def sauber(text):
    return re.sub(r"\s+", " ", text).strip()


def hol(woerterbuch, pfad):
    """Die Sprachdateien nutzen FLACHE Schluessel ("limit.title").

    Erst flach nachsehen, dann verschachtelt — ein erster Anlauf am 21.08. hat
    nur verschachtelt gesucht, nichts gefunden und deshalb faelschlich "alles in
    Ordnung" gemeldet. Ein leeres Ergebnis ist zuerst ein Verdacht gegen das
    Messmittel.
    """
    if isinstance(woerterbuch.get(pfad), str):
        return woerterbuch[pfad]
    stelle = woerterbuch
    for teil in pfad.split("."):
        if not isinstance(stelle, dict) or teil not in stelle:
            return None
        stelle = stelle[teil]
    return stelle if isinstance(stelle, str) else None


def main():
    try:
        de = json.load(open("public/locales/de.json", encoding="utf-8"))
        en = json.load(open("public/locales/en.json", encoding="utf-8"))
    except (OSError, ValueError) as fehler:
        print(f"MESSPROBLEM: Sprachdateien nicht lesbar — {fehler}")
        return 2

    dateien = sorted(glob.glob("public/*.html") + glob.glob("public/en/*.html"))
    if not dateien:
        print("MESSPROBLEM: keine HTML-Dateien gefunden — falsches Verzeichnis?")
        return 2

    abweichungen = []
    fehlende = []
    geprueft = 0

    for datei in dateien:
        try:
            roh = open(datei, encoding="utf-8").read()
        except OSError as fehler:
            print(f"MESSPROBLEM: {datei} nicht lesbar — {fehler}")
            return 2

        sammler = TextSammler()
        sammler.feed(roh)
        sammler.close()
        woerterbuch = en if "/en/" in datei else de

        for schluessel, text, zeile in sammler.treffer:
            ist = sauber(text)
            if not ist:
                continue  # leeres Element: nichts zu vergleichen
            geprueft += 1
            soll = hol(woerterbuch, schluessel)
            if soll is None:
                fehlende.append((datei, zeile, schluessel))
                continue
            if ist != sauber(soll):
                abweichungen.append((datei, zeile, schluessel, ist, sauber(soll)))

    if geprueft == 0:
        print("MESSPROBLEM: kein einziges data-i18n-Element gefunden — Prüfung greift ins Leere.")
        return 2

    print(f"Geprüft: {geprueft} Texte mit data-i18n in {len(dateien)} Seiten.")

    for datei, zeile, schluessel in fehlende:
        print(f"\nFEHLT  {datei}:{zeile}  [{schluessel}]")
        print("       Schlüssel steht in keiner Sprachdatei.")

    for datei, zeile, schluessel, ist, soll in abweichungen:
        print(f"\nABWEICHUNG  {datei}:{zeile}  [{schluessel}]")
        print(f"       im HTML sichtbar : {ist[:120]}")
        print(f"       in der Sprachdatei: {soll[:120]}")

    if abweichungen or fehlende:
        print(
            f"\nERGEBNIS: {len(abweichungen)} Abweichung(en), {len(fehlende)} fehlende(r) Schlüssel.\n"
            "Der HTML-Text ist das, was Besucher sehen, bevor die Sprachdatei greift —\n"
            "und das, was sie dauerhaft sehen, wenn sie nicht greift. Beide Fassungen\n"
            "müssen dasselbe sagen."
        )
        return 1

    print("ERGEBNIS: grün — jeder sichtbare Text stimmt mit seiner Sprachdatei überein.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
