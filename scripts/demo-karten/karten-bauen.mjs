// Schritt 2: Kacheln zusammensetzen und auf den Ausschnitt zuschneiden.
// Erzeugt je Ort zwei verlustfreie Zwischenbilder (roh/<name>-z15.png mit
// 640x238 und roh/<name>-z16.png mit 1280x476), der Ort liegt in der Bildmitte.
// Werkzeug: ImageMagick (magick). Kein Neuabtasten, nur Aneinanderlegen und
// Schneiden.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { ORTE, STUFEN, ausschnitt } from "./kacheln-laden.mjs";

mkdirSync("roh", { recursive: true });
for (const [name, ort] of Object.entries(ORTE)) {
  for (const z of Object.keys(STUFEN).map(Number)) {
    const a = ausschnitt(ort.lat, ort.lng, z);
    const kacheln = [];
    for (let y = a.ky0; y <= a.ky1; y++) for (let x = a.kx0; x <= a.kx1; x++) kacheln.push(`kacheln/${z}/${x}/${y}.png`);
    const spalten = a.kx1 - a.kx0 + 1;
    const zeilen = a.ky1 - a.ky0 + 1;
    const mosaik = `roh/${name}-z${z}-mosaik.png`;
    /* Zeilenweise nebeneinander (+append), die Zeilen untereinander (-append). */
    const args = [];
    for (let r = 0; r < zeilen; r++) args.push("(", ...kacheln.slice(r * spalten, (r + 1) * spalten), "+append", ")");
    execFileSync("magick", [...args, "-append", mosaik]);
    const dx = a.links - a.kx0 * 256;
    const dy = a.oben - a.ky0 * 256;
    const ziel = `roh/${name}-z${z}.png`;
    execFileSync("magick", [mosaik, "-crop", `${a.breite}x${a.hoehe}+${dx}+${dy}`, "+repage", "-strip", ziel]);
    /* Wo liegt der Ort im fertigen Bild? Erwartet: genau die Mitte (auf einen
       halben Bildpunkt genau, wegen der Rundung auf ganze Bildpunkte). */
    const ortX = a.mitte.x - a.links;
    const ortY = a.mitte.y - a.oben;
    console.log(`${ziel}: ${spalten}x${zeilen} Kacheln, Schnitt +${dx}+${dy}, Ort bei ${ortX.toFixed(2)}/${ortY.toFixed(2)} (Mitte waere ${a.breite / 2}/${a.hoehe / 2})`);
  }
}
