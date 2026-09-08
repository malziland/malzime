/**
 * heic.js — oeffnet HEIC-Fotos im Browser, wenn der Browser es selbst nicht kann.
 *
 * WARUM (08.09.2026): Samsung-Handys speichern Fotos ab Werk als HEIC, und
 * Android-Browser koennen das Format nicht oeffnen (iPhone-Browser schon). In
 * einer Klasse scheiterten so 3 von 31 Versuchen mit "Format nicht
 * unterstuetzt" — ein Fehler, den das Kind sieht, also unser Fehler.
 *
 * WIE: Der Dekoder (libheif mit libde265, LGPL-3.0, siehe
 * lib/libheif/VERSION und THIRD-PARTY.md) liegt als getrennte Datei auf
 * unserem eigenen Server und wird NUR geladen, wenn ein HEIC-Foto ausgewaehlt
 * wurde und der Browser es nicht selbst oeffnen konnte. Er laeuft
 * vollstaendig im Browser: Das Foto verlaesst das Geraet nicht, und das
 * Ergebnis geht denselben Weg wie jedes andere Foto — Metadaten weg,
 * verkleinert, dann erst zum Server. Kein Aufruf nach aussen; die
 * Sicherheitsrichtlinie der Seite erlaubt ohnehin nur die eigene Adresse.
 *
 * Fuer Tests austauschbar: `setDekoderLaderForTest`.
 */

const SKRIPT = "./lib/libheif/libheif.js";
const WASM = "./lib/libheif/libheif.wasm";

let dekoderVersprechen = null;
let laderOverride = null;

/* Laedt Skript und WebAssembly-Binary genau einmal je Seite. Das Binary wird
   vorab geholt und uebergeben — der Emscripten-Bau erwartet das im Browser so;
   ein Fehlversuch wird nicht zwischengespeichert, damit ein zweites Foto
   einen neuen Anlauf bekommt. */
async function ladeDekoder() {
  if (laderOverride) return laderOverride();
  if (!dekoderVersprechen) {
    dekoderVersprechen = (async () => {
      const [wasmBinary] = await Promise.all([
        fetch(WASM).then((r) => {
          if (!r.ok) throw new Error(`wasm ${r.status}`);
          return r.arrayBuffer();
        }),
        new Promise((resolve, reject) => {
          if (typeof window.libheif === "function") return resolve();
          const s = document.createElement("script");
          s.src = SKRIPT;
          s.onload = resolve;
          s.onerror = () => reject(new Error("skript"));
          document.head.appendChild(s);
        }),
      ]);
      const modul = window.libheif({ wasmBinary });
      await new Promise((resolve) => {
        if (modul.calledRun) resolve();
        else modul.onRuntimeInitialized = resolve;
      });
      return modul;
    })().catch((err) => {
      dekoderVersprechen = null;
      throw err;
    });
  }
  return dekoderVersprechen;
}

/**
 * Dekodiert HEIC-Bytes zu einem Canvas in Originalgroesse.
 * Wirft `image_decode_failed` mit `errorDetail` "heic:<grund>", damit die
 * Fehlererfassung sieht, WO es scheiterte — Laden, Dekodieren oder Zeichnen.
 */
export async function heicZuCanvas(bytes) {
  let modul;
  try {
    modul = await ladeDekoder();
  } catch (err) {
    throw fehler("heic:laden:" + ((err && err.message) || "?"));
  }
  let bild;
  try {
    const dekoder = new modul.HeifDecoder();
    const bilder = dekoder.decode(bytes);
    bild = bilder && bilder[0];
    if (!bild) throw new Error("leer");
  } catch (err) {
    throw fehler("heic:dekodieren:" + ((err && err.message) || "?"));
  }
  const breite = bild.get_width();
  const hoehe = bild.get_height();
  const canvas = document.createElement("canvas");
  canvas.width = breite;
  canvas.height = hoehe;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw fehler("heic:canvas");
  const daten = ctx.createImageData(breite, hoehe);
  await new Promise((resolve, reject) => {
    try {
      bild.display(daten, (ergebnis) => (ergebnis ? resolve() : reject(fehler("heic:zeichnen"))));
    } catch (err) {
      reject(fehler("heic:zeichnen:" + ((err && err.message) || "?")));
    }
  });
  ctx.putImageData(daten, 0, 0);
  return canvas;
}

function fehler(detail) {
  const err = new Error("image_decode_failed");
  err.errorDetail = detail.slice(0, 60);
  return err;
}

/* Nur fuer Tests. */
export function setDekoderLaderForTest(fn) {
  laderOverride = fn || null;
  dekoderVersprechen = null;
}
