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

Lizenz: wie das Repository — **MIT** (siehe [`/LICENSE`](../../../LICENSE)).

---

The three demo photos in this folder (`demo-selfie`, `demo-cafe`, `demo-hiker`,
each with its thumbnail) are **AI-generated** (confirmed,
2026-07-17). They depict **no real persons** — any resemblance to living or
deceased persons would be purely coincidental. The EXIF data (camera, location,
date) is **intentionally fictional**, serving malziME's demo purpose of making
hidden photo metadata visible.

License: same as the repository — **MIT** (see [`/LICENSE`](../../../LICENSE)).

**Two language variants.** The AI marking is burned into the image pixels and
therefore cannot be translated at runtime. Each image exists twice: without
suffix showing „KI ERSTELLT" (German) and with `-en` showing „AI GENERATED"
(English). The page picks by selected language. Both are produced from the same
originals via `node scripts/ki-wasserzeichen.mjs [--lang=en]`; the unmarked
originals deliberately live outside `public/` (in `.demo-originale/`) so they are
never served.
