import { describe, test, expect, vi, afterEach } from "vitest";

vi.mock("../lib/exifr/lite.esm.mjs", () => ({
  default: { parse: vi.fn().mockResolvedValue(null) },
}));

import { prepareImage } from "../js/exif.js";

/* ── BUG-2026-08-19-01 ──────────────────────────────────────────────────────
   Am 19.08.2026 um 07:42 und 07:43 Uhr scheiterten zwei Uploads desselben
   iPhones mit `enqueue HTTP 400`. Der Server protokollierte dazu:

       {"behauptet":"image/jpeg","erkannt":"image/png","warning":"mime-mismatch"}

   Das Frontend rechnet jedes Bild ueber den Canvas neu und schrieb bis dahin
   FEST `mimeType: "image/jpeg"` in die Anfrage (public/js/api.js). Der Canvas
   hatte aber PNG geliefert. Der Server prueft seit SEC-2026-08-12-19 den
   INHALT statt der Behauptung — voellig zu Recht — und wies ab.

   Warum der Canvas PNG liefert, ist browserseitig nicht abschliessend
   geklaert: `toDataURL(typ, guete)` faellt laut Norm auf PNG zurueck, wenn der
   gewuenschte Typ nicht geliefert werden kann. Fuer die Behebung ist das auch
   nicht noetig — und genau darin liegt ihr Wert: Sie haengt nicht davon ab,
   die Ursache im fremden Browser zu kennen.

   Die Regel lautet ab jetzt: Das Frontend behauptet nichts, sondern meldet,
   was tatsaechlich herauskam. Der Server erlaubt PNG ohnehin (ALLOWED_MIME),
   und seine inhaltliche Pruefung bleibt unangetastet.

   Fuer den Menschen davor sah der Fehler aus wie "die Seite funktioniert
   nicht" — zweimal, dann hat er aufgegeben. Deshalb ist das kein Schoenheits-
   fehler. */

/* Ein Canvas, der genau das zurueckgibt, was der Browser an jenem Morgen
   zurueckgab. Sonst nichts nachgebaut — nur was prepareImage anfasst. */
function canvasLiefert(datenUrl) {
  const echt = document.createElement.bind(document);
  return vi.spyOn(document, "createElement").mockImplementation((tag) => {
    if (tag !== "canvas") return echt(tag);
    return {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {}, imageSmoothingQuality: "" }),
      toDataURL: () => datenUrl,
    };
  });
}

/* Ein Bild, das sofort geladen ist. */
function bildLaedtSofort(breite = 800, hoehe = 600) {
  const Vorher = globalThis.Image;
  globalThis.Image = class {
    constructor() {
      this.width = breite;
      this.height = hoehe;
    }
    set src(_) {
      setTimeout(() => this.onload && this.onload(), 0);
    }
  };
  return () => {
    globalThis.Image = Vorher;
  };
}

function datei() {
  /* PNG-Signatur, damit auch die Formaterkennung etwas Echtes sieht. */
  const b = new Uint8Array(32);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((v, i) => (b[i] = v));
  return { size: b.length, type: "image/png", arrayBuffer: async () => b.buffer };
}

let aufraeumen = [];
afterEach(() => {
  aufraeumen.forEach((f) => f());
  aufraeumen = [];
  vi.restoreAllMocks();
});

describe("BUG-2026-08-19-01: der gemeldete Typ ist der tatsaechliche", () => {
  test("Canvas liefert PNG — prepareImage meldet image/png, nicht image/jpeg", async () => {
    aufraeumen.push(bildLaedtSofort());
    canvasLiefert("data:image/png;base64,iVBORw0KGgo=");
    globalThis.URL.createObjectURL = () => "blob:x";
    globalThis.URL.revokeObjectURL = () => {};

    const ergebnis = await prepareImage(datei());

    /* Positivkontrolle: Kaeme gar kein Bild heraus, wuerde die Zusicherung
       darunter auch bei kaputter Aufbereitung "bestehen". */
    expect(ergebnis.imageBase64.length).toBeGreaterThan(0);

    expect(ergebnis.mimeType, "prepareImage muss den Typ melden, den der Canvas wirklich geliefert hat").toBe(
      "image/png"
    );
  });

  test("Canvas liefert JPEG — dann meldet prepareImage image/jpeg", async () => {
    aufraeumen.push(bildLaedtSofort());
    canvasLiefert("data:image/jpeg;base64,/9j/4AAQ");
    globalThis.URL.createObjectURL = () => "blob:x";
    globalThis.URL.revokeObjectURL = () => {};

    const ergebnis = await prepareImage(datei());
    expect(ergebnis.imageBase64.length).toBeGreaterThan(0);
    expect(ergebnis.mimeType).toBe("image/jpeg");
  });

  test("Der Dateiname passt zum Typ", async () => {
    /* Ein PNG als upload.jpg zu benennen ist dieselbe Unwahrheit eine Ebene
       tiefer — sie faellt nur niemandem auf, weil der Server den Namen nicht
       prueft. Das ist kein Grund, ihn falsch zu setzen. */
    aufraeumen.push(bildLaedtSofort());
    canvasLiefert("data:image/png;base64,iVBORw0KGgo=");
    globalThis.URL.createObjectURL = () => "blob:x";
    globalThis.URL.revokeObjectURL = () => {};

    const ergebnis = await prepareImage(datei());
    expect(ergebnis.dateiname).toBe("upload.png");
  });
});
