# Fremde Bestandteile und ihre Lizenzen

Der eigene Quelltext von malziME steht unter der **MIT-Lizenz** (siehe `LICENSE`).
Diese Lizenz gilt **nicht** für die hier aufgeführten fremden Bestandteile. Jeder
davon bringt seine eigene Lizenz mit, und die gilt unverändert weiter.

| Bestandteil                                          | Lizenz                    | Rechteinhaber                  | Lizenztext                     |
| ---------------------------------------------------- | ------------------------- | ------------------------------ | ------------------------------ |
| [Leaflet](https://leafletjs.com) 1.9.4               | BSD 2-Clause              | Volodymyr Agafonkin; CloudMade | `public/lib/leaflet/LICENSE`   |
| [exifr](https://github.com/MikeKovarik/exifr) 7.1.x  | MIT                       | Mike Kovařík, Mutiny.cz        | `public/lib/exifr/LICENSE`     |
| [Poppins](https://fonts.google.com/specimen/Poppins) | SIL Open Font License 1.1 | Indian Type Foundry            | `public/fonts/poppins/OFL.txt` |

Die Herkunft jeder Datei und jede Abweichung vom Original stehen in der
`VERSION`-Datei des jeweiligen Ordners. Alle Dateien sind mit einer Prüfsumme
hinterlegt (`public/lib/PRUEFSUMMEN.json`); eine Änderung an fremdem Code fällt
dadurch im Bau auf.

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
