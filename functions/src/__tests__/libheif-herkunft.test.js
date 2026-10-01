const fs = require("fs");
const path = require("path");

/**
 * Wächter für die Versionsangaben des HEIC-Dekoders (Befund G-07, 30.09.2026).
 *
 * Die Version des Dekoders steht an drei Stellen, die niemand gekoppelt hatte:
 * im Rezept (scripts/libheif-bauen.sh, daraus wird gebaut), in
 * public/lib/libheif/VERSION (daraus liest der Nachtlauf, gegen welche
 * Sicherheitsmeldungen er prüft) und in der ausgelieferten libheif.wasm selbst.
 * Wer die VERSION-Datei auf eine neuere Version setzt, ohne neu zu bauen, liess
 * früher alles grün — und der Nachtlauf hätte Meldungen als erledigt gewertet,
 * deren Reparatur gar nicht ausgeliefert wird.
 *
 * Kein Netz, keine Schreibzugriffe.
 */

const REPO = path.join(__dirname, "../../..");
const lies = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

function ausRezept(name) {
  const m = new RegExp(`^${name}="([^"]+)"`, "m").exec(lies("scripts/libheif-bauen.sh"));
  if (!m) throw new Error(`${name} steht nicht im Rezept`);
  return m[1];
}

function ausVersion(name) {
  const m = new RegExp(`^${name} (\\d+\\.\\d+\\.\\d+)\\b`, "m").exec(lies("public/lib/libheif/VERSION"));
  if (!m) throw new Error(`Zeile "${name} x.y.z" fehlt in public/lib/libheif/VERSION`);
  return m[1];
}

/* Dieselbe Auslesung wie im Rezept (versionen_im_wasm): alle Zeichenfolgen der
   Form x.y.z in der Binärdatei, exakt verglichen. */
function versionenImWasm() {
  const text = fs.readFileSync(path.join(REPO, "public/lib/libheif/libheif.wasm")).toString("latin1");
  return [...new Set(text.match(/[0-9]+\.[0-9]+\.[0-9]+/g) || [])].sort();
}

describe("HEIC-Dekoder: Versionsangaben gekoppelt", () => {
  test("Rezept und VERSION-Datei nennen dieselben Versionen", () => {
    expect(ausVersion("libheif")).toBe(ausRezept("NEU_LIBHEIF_VERSION"));
    expect(ausVersion("libde265")).toBe(ausRezept("NEU_LIBDE265_VERSION"));
  });

  test("die ausgelieferte libheif.wasm trägt genau diese Versionen", () => {
    /* Positivkontrolle: Die Auslesung muss überhaupt etwas finden. */
    const imWasm = versionenImWasm();
    expect(imWasm.length).toBeGreaterThan(0);
    expect(imWasm).toEqual([ausVersion("libde265"), ausVersion("libheif")].sort());
  });

  test("die Emscripten-Version in VERSION entspricht dem Rezept", () => {
    const rezept = ausRezept("EMSDK_VERSION");
    const m = /Emscripten (\d+\.\d+\.\d+)/.exec(lies("public/lib/libheif/VERSION"));
    /* null hiesse: VERSION nennt keine Emscripten-Version. */
    expect(m).not.toBeNull();
    expect(m[1]).toBe(rezept);
  });

  test("die Herkunftszeile in PRUEFSUMMEN.json nennt dieselben Versionen", () => {
    const herkunft = JSON.parse(lies("public/lib/PRUEFSUMMEN.json"))._herkunft["public/lib/libheif"];
    expect(herkunft).toContain(`libheif ${ausVersion("libheif")}`);
    expect(herkunft).toContain(`libde265 ${ausVersion("libde265")}`);
  });
});
