# Fremde Bestandteile und ihre Lizenzen

Der eigene Quelltext von malziME steht unter der **MIT-Lizenz** (siehe `LICENSE`).
Diese Lizenz gilt **nicht** für die hier aufgeführten fremden Bestandteile. Jeder
davon bringt seine eigene Lizenz mit, und die gilt unverändert weiter.

| Bestandteil                                          | Lizenz                    | Rechteinhaber                  | Lizenztext                     |
| ---------------------------------------------------- | ------------------------- | ------------------------------ | ------------------------------ |
| [Leaflet](https://leafletjs.com) 1.9.4               | BSD 2-Clause              | Volodymyr Agafonkin; CloudMade | `public/lib/leaflet/LICENSE`   |
| [exifr](https://github.com/MikeKovarik/exifr) 7.1.3  | MIT                       | Mike Kovařík, Mutiny.cz        | `public/lib/exifr/LICENSE`     |
| [Poppins](https://fonts.google.com/specimen/Poppins) | SIL Open Font License 1.1 | Indian Type Foundry            | `public/fonts/poppins/OFL.txt` |
| [libheif](https://github.com/strukturag/libheif) 1.23.5 mit [libde265](https://github.com/strukturag/libde265) 1.1.3, als WebAssembly selbst gebaut aus den Original-Quellen (`scripts/libheif-bauen.sh`) | LGPL 3.0 | Dirk Farin, struktur AG | `public/lib/libheif/LICENSE` |

Die Herkunft jeder Datei und jede Abweichung vom Original stehen in der
`VERSION`-Datei des jeweiligen Ordners.

**libheif ist LGPL, nicht MIT oder BSD — das verlangt mehr:** Die Bibliothek
liegt als getrennte, austauschbare Datei vor (`libheif.js` + `libheif.wasm`), wird
nur über ihre öffentliche Schnittstelle aufgerufen und erst geladen, wenn ein
HEIC-Foto ausgewählt wurde. Der eigene Code (`public/js/heic.js`) bleibt MIT. Wer
die Bibliothek austauschen will, ersetzt die beiden Dateien. Seit 30.09.2026 bauen
wir sie selbst: aus den unveränderten Quellen der Hersteller in genau der
genannten Version, mit dem Bauskript des Herstellers. Das Rezept liegt offen
(`scripts/libheif-bauen.sh`), der Workflow `.github/workflows/libheif-bau.yml` baut
es auf GitHub nach und vergleicht Byte für Byte mit den ausgelieferten Dateien —
jede und jeder kann den Bau damit wiederholen. Die Nutzung ist auf der Website
sichtbar genannt (Impressum, „Verwendete Open-Source-Software") und in der
Datenschutzerklärung beschrieben (Umwandlung vollständig im Browser). Alle Dateien
sind mit einer Prüfsumme hinterlegt (`public/lib/PRUEFSUMMEN.json`); eine Änderung
an fremdem Code fällt dadurch im Bau auf.

## Karte und Adressen: OpenStreetMap

Die Kartenkacheln und die Adressauflösung kommen zur Laufzeit direkt vom Browser
der Besucherin oder des Besuchers. **In diesem Repository liegt kein Material von
OpenStreetMap.**

- Kartendaten: [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/)
- Gerenderte Kacheln: CC-BY-SA 2.0
- Adressauflösung: [Nominatim](https://nominatim.org), betrieben von der OpenStreetMap Foundation

Daraus folgt keine Auflage für den Quelltext dieses Projekts. Die Auflage, die
tatsächlich gilt, ist die **Namensnennung mit Verweis auf die Lizenzseite** — sie
steht in der Karte selbst (`js/render.js`, Textbaustein `gps.osmCredit`) und wird
von `e2e/karte.test.js` dauerhaft geprüft.

## Beim Einbau eines neuen fremden Bestandteils

1. Den **vollständigen** Lizenztext des Originals in den Ordner legen, wörtlich —
   eine Copyright-Zeile allein genügt weder für MIT noch für BSD.
2. Eine `VERSION`-Datei mit Herkunft, Version, Lizenz und **jeder** Abweichung
   vom Original.
3. Prüfsumme in `public/lib/PRUEFSUMMEN.json` eintragen.
4. Diese Tabelle ergänzen.

Punkt 1 und 4 werden von `public/__tests__/lizenzen-vollstaendig.test.js`
erzwungen; ohne sie wird der Bau rot.
