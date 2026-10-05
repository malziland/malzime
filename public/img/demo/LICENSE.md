# Demo-Fotos — KI-generiert / Demo photos — AI-generated

Die drei Demo-Fotos in diesem Ordner (`demo-selfie`, `demo-cafe`, `demo-hiker`,
jeweils samt Thumbnail) sind **KI-generiert** (bestätigt,
2026-07-17). Sie zeigen **keine realen Personen** — Ähnlichkeiten mit lebenden
oder verstorbenen Personen wären rein zufällig.

<!-- ABGRENZUNG zur Formulierungsregel vom 19.08.2026: Das Wort "fiktiv" ist hier
     richtig und bleibt. Die Regel verbietet es fuer die KI-PROFILE (die erfindet
     niemand — eine echte KI raet sie wirklich). Die EXIF-Daten dieser Demo-Bilder
     dagegen sind tatsaechlich gesetzt: Es gibt keinen echten Aufnahmeort. -->

Die EXIF-Daten der Bilder (Kamera, Aufnahmeort, Datum) sind **bewusst fiktiv**
gesetzt — sie dienen dem Demo-Zweck von malziME, versteckte Foto-Metadaten
sichtbar zu machen.

**Zwei Sprachfassungen.** Die KI-Kennzeichnung ist in die Bildpixel gebrannt und
kann deshalb nicht mitübersetzen. Es gibt daher je Bild zwei Dateien: ohne Endung
mit „KI ERSTELLT" (deutsch) und mit `-en` mit „AI GENERATED" (englisch). Die Seite
wählt nach eingestellter Sprache. Erzeugt werden beide aus denselben Originalen
mit `node scripts/ki-wasserzeichen.mjs [--lang=en]`; die un-gekennzeichneten
Originale liegen bewusst außerhalb von `public/` (in `.demo-originale/`), damit
sie nicht ausgeliefert werden.

**Feste Kartenausschnitte und Adressen (OpenStreetMap).** Für die Ortsdaten
eines Demo-Fotos fragt der Browser nichts bei OpenStreetMap an. Die
Ergebnis-Seite zeigt je Ort einen mitgelieferten Kartenausschnitt und eine
mitgelieferte Adresse:

- `karte-selfie.webp`, `karte-cafe.webp`, `karte-hiker.webp` — 640 × 238
  Bildpunkte, Zoomstufe 15, der Ort liegt in der Bildmitte; dazu je eine Fassung
  `-2x` mit doppelter Punktdichte (1280 × 476, Zoomstufe 16).
- Die Adressen stehen in `public/locales/de.json` und `en.json` (`demo.place.*`),
  im Wortlaut der Ortsauflösung Nominatim für diese Koordinaten.

Quelle der Kartenausschnitte und der Adressen: **© OpenStreetMap-Mitwirkende**.
Die Daten stehen unter der Open Database License (ODbL) 1.0 —
<https://www.openstreetmap.org/copyright>. Abgerufen einmalig am 03.10.2026
(Kacheln von `tile.openstreetmap.org`, Adressen von
`nominatim.openstreetmap.org`); die Kacheln wurden aneinandergelegt,
zugeschnitten und für die Auslieferung komprimiert. Die Quellenangabe steht auf
der Seite an der Karte und in den Metadaten jeder Datei. Die Kartenausschnitte
sind keine KI-Bilder und tragen deshalb keine KI-Kennzeichnung.

Ändern sich die Ortsdaten eines Demo-Fotos, gehören Kartenausschnitt und Adresse
neu erzeugt — `public/__tests__/beispielbild-karten.test.js` wird sonst rot. Wie
die Kartenausschnitte hergestellt werden, steht als Rezept in
`scripts/demo-karten/` (drei Schritte: Kacheln laden, zuschneiden, ausgeben).

Lizenz der Demo-Fotos: wie das Repository — **MIT** (siehe
[`/LICENSE`](../../../LICENSE)). Die Kartenausschnitte und Adressen sind davon
nicht umfasst; für sie gilt die Quellenangabe oben.

---

The three demo photos in this folder (`demo-selfie`, `demo-cafe`, `demo-hiker`,
each with its thumbnail) are **AI-generated** (confirmed,
2026-07-17). They depict **no real persons** — any resemblance to living or
deceased persons would be purely coincidental. The EXIF data (camera, location,
date) is **intentionally fictional**, serving malziME's demo purpose of making
hidden photo metadata visible.

License of the demo photos: same as the repository — **MIT** (see
[`/LICENSE`](../../../LICENSE)). The map sections and addresses described below
are not covered by it; the attribution given there applies to them.

**Two language variants.** The AI marking is burned into the image pixels and
therefore cannot be translated at runtime. Each image exists twice: without
suffix showing „KI ERSTELLT" (German) and with `-en` showing „AI GENERATED"
(English). The page picks by selected language. Both are produced from the same
originals via `node scripts/ki-wasserzeichen.mjs [--lang=en]`; the unmarked
originals deliberately live outside `public/` (in `.demo-originale/`) so they are
never served.

**Fixed map sections and addresses (OpenStreetMap).** For the location data of a
demo photo, the browser requests nothing from OpenStreetMap. For each location,
the result page shows a map section and an address that ship with the site:

- `karte-selfie.webp`, `karte-cafe.webp`, `karte-hiker.webp` — 640 × 238 pixels,
  zoom level 15, the location sits at the centre of the image; plus one `-2x`
  variant each at double pixel density (1280 × 476, zoom level 16).
- The addresses are in `public/locales/de.json` and `en.json` (`demo.place.*`),
  worded as the Nominatim geocoder returns them for these coordinates.

Source of the map sections and addresses: **© OpenStreetMap contributors**. The
data is available under the Open Database License (ODbL) 1.0 —
<https://www.openstreetmap.org/copyright>. Retrieved once on 3 October 2026
(tiles from `tile.openstreetmap.org`, addresses from
`nominatim.openstreetmap.org`); the tiles were joined, cropped and compressed for
delivery. The attribution is shown on the page next to the map and stored in the
metadata of each file. The map sections are not AI images and therefore carry no
AI marking.

If the location data of a demo photo changes, its map section and address must
be regenerated — otherwise `public/__tests__/beispielbild-karten.test.js` fails.
How the map sections are produced is recorded as a recipe in
`scripts/demo-karten/` (three steps: fetch the tiles, crop, write the files).
