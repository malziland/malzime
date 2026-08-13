# PRUEFUNGEN — vier Kontrollen statt vier Bitten


> **Herkunft:** Kopie des Werkzeugkastens aus der Audit-Familie
> (`~/.claude/skills/audit-familie/pruefungen`). **Bearbeitet wird die QUELLE, nie diese
> Kopie** — danach neu einkopieren und mit `node scripts/pruefe-vendorierung.mjs --aktualisieren`
> stempeln. Der Waechter `scripts/pruefe-vendorierung.mjs` meldet jede Abweichung.
>
> Der Ordner `negativprobe/` enthaelt **absichtlich fehlerhaftes Beispielmaterial** und
> wird von allen Pruefungen uebersprungen.

Diese vier Pruefungen setzen Regeln der Familie in Programme um, die rot werden koennen.
Der Unterschied ist der Kern der ganzen Sache: Eine Regel im Prompt wirkt vielleicht,
eine Pruefung in der Pipeline wirkt immer.

Jede der vier deckt eine Fehlerklasse ab, die in der Praxis tatsaechlich Schaden
angerichtet hat.

## Die vier Pruefungen

**fakten-drift.py** findet Fakten, die an mehreren Stellen verschieden stehen. Zahl der
Tests, Version, Abdeckung, Fristen. Die haeufigste Befundklasse ueberhaupt. Setzt die
Ein-Quellen-Regel (KERN 11) durch.

**stiller-fehlschlag.py** findet Stellen, an denen ein Fehlschlag wie Erfolg aussieht:
Erfolgsmeldung nach Semikolon statt nach `&&`, verschluckte Fehler, Rueckgabewert nach
einer Pipe, fehlendes `set -e`. Setzt KERN 5c durch.

**aussentext.py** prueft Texte, die nach aussen gehen, gegen eine Liste verbotener
Formulierungen. Mit eingebauter Positivkontrolle: Schlaegt die Suche an einem bekannten
Verstoss nicht an, meldet die Pruefung, dass sie selbst kaputt ist, statt gruen zu
werden.

**test-blind.py** findet Tests, die rechnerisch nicht rot werden koennen: ohne
Zusicherung, uebersprungen, immer wahr. Setzt KERN 4 Frage 2 durch.

## Aufruf

    sh pruefe-alles.sh /pfad/zum/projekt

Einzeln:

    python3 checks/fakten-drift.py /pfad/zum/projekt

Rueckgabewerte: 0 sauber, 1 Fundstellen, 2 keine Suchflaeche oder Aufrufproblem. Der
Wert 2 ist ausdruecklich kein Erfolg: Eine Pruefung, die nichts zu pruefen fand, hat
nichts bestanden.

## Selbstpruefung

    sh selbstpruefung.sh

Fuehrt jede Pruefung zweimal aus: gegen absichtlich kaputtes Material, wo sie rot werden
MUSS, und gegen sauberes Material, wo sie gruen bleiben muss. Die Probenzahl steht nur im Skript und wird von selbstpruefung.sh gezaehlt.

Das ist der Teil, der beim ersten Anlauf der Familie gefehlt hat. Damals wurde ein
Pruefskript nur gegen fehlerhaftes Material getestet, wurde korrekt rot, und liess
trotzdem beliebigen Unsinn durch, weil die zweite Richtung nie geprueft wurde. Beim Bau
dieser vier Pruefungen hat die zweite Richtung sofort einen Fehlalarm gefunden
(`pytest.raises` wurde nicht als Zusicherung erkannt). Ohne sie waere er in Betrieb
gegangen.

## Einbau ins Projekt

Damit aus den Pruefungen Kontrollen werden, muessen sie mitlaufen, nicht auf Zuruf
starten. Drei Stufen, je nach Ausbaustufe des Projekts:

1. **Von Hand**, vor jeder Abgabe: `sh pruefe-alles.sh .`
2. **Vor dem Commit**, ueber den Vor-Commit-Haken des Projekts.
3. **In der Pipeline**, als eigener Job. Ein roter Job bricht ab. Erst hier ist es
   wirklich eine Kontrolle, weil sie sich nicht vergessen laesst.

Der `/projektstart` baut Stufe 3 ab der Ausbaustufe STANDARD ein.

## Anpassen

`.pruefungen/aussentext.txt` im Projekt enthaelt die verbotenen Formulierungen. Beim
ersten Lauf wird eine Vorlage angelegt, die anzupassen ist.

`.pruefungen/fakten.txt` kann eigene Fakt-Muster ergaenzen, je Zeile
`Bezeichnung|regulaerer Ausdruck mit einer Klammergruppe`.

## Grenzen

Was diese vier Pruefungen nicht finden koennen, und wo die Kontrolle stattdessen wohnt:

- Ob eine Aussage inhaltlich stimmt. Sie pruefen Form und Widerspruch, nicht Wahrheit.
- Ob ein Test das Richtige prueft. Sie finden nur Tests, die gar nichts pruefen koennen.
- Ob ein Satz auf dem Bildschirm Sinn ergibt. Kein Werkzeug der Kette liest die Sprache
  des Nutzers; das bleibt Sichtpruefung durch einen Menschen.
- Zustandsdrift in der Aussenwelt (Regionen, Zugriffsrechte, Fristen beim Anbieter).
  Dafuer ist das Zusagen-Pruefskript des Projekts zustaendig (KERN 6).
