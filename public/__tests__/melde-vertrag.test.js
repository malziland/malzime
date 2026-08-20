/* BUG-2026-08-20-02, nachhaltiger Teil: Der Logger baut seinen Rumpf aus einer
   FESTEN Feldliste. Wer einen String statt eines Fehlers uebergibt oder ein Feld
   erfindet, verliert seine Angaben — ohne Warnung, ohne roten Test. Genau so war
   der Melder fuer den Druck-Abbruch-Fehler blind gebaut, und genau so ging in
   demo.js die Angabe verloren, welches Beispielbild es getroffen hat.

   Dieser Test liest die Aufrufstellen im ausgelieferten Code und haelt beide
   Vertragsbedingungen fest. Er prueft die FLAECHE, nicht eine Liste bekannter
   Stellen: Jede neue Aufrufstelle faellt automatisch darunter. */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HIER, "..");

/* Die Feldliste stammt aus js/error-logger.js (Rumpfbau) und ist serverseitig in
   functions/src/handle-errors.js gespiegelt. Was hier fehlt, kommt nicht an. */
const ERLAUBTE_FELDER = new Set([
  "phase",
  "durationMs",
  "requestId",
  "traceId",
  "httpStatus",
  "wakeLock",
  "fileFormat",
  "errorDetail",
  "fileSizeKb",
  "timings",
]);

function jsDateien(verzeichnis) {
  const gefunden = [];
  for (const name of readdirSync(verzeichnis)) {
    if (name === "__tests__" || name === "lib" || name === "fonts") continue;
    const pfad = join(verzeichnis, name);
    if (statSync(pfad).isDirectory()) gefunden.push(...jsDateien(pfad));
    else if (name.endsWith(".js") && name !== "error-logger.js") gefunden.push(pfad);
  }
  return gefunden;
}

/** Findet `logClientError(` samt zugehörigem Argument-Text (Klammern gezählt). */
function aufrufe(quelltext) {
  const treffer = [];
  const muster = /logClientError\s*\(/g;
  while (muster.exec(quelltext)) {
    let tiefe = 1;
    let i = muster.lastIndex;
    while (i < quelltext.length && tiefe > 0) {
      if (quelltext[i] === "(") tiefe++;
      else if (quelltext[i] === ")") tiefe--;
      i++;
    }
    treffer.push(quelltext.slice(muster.lastIndex, i - 1));
  }
  return treffer;
}

const stellen = jsDateien(PUBLIC).flatMap((pfad) =>
  aufrufe(readFileSync(pfad, "utf8")).map((argumente) => ({ pfad: pfad.replace(PUBLIC, "public"), argumente }))
);

describe("Vertrag der Fehlermeldung (logClientError)", () => {
  test("es gibt überhaupt Aufrufstellen (Positivkontrolle des Messmittels)", () => {
    /* Ohne diese Zusicherung wäre ein kaputter Sucher grün: keine Treffer,
       keine Verstöße, alles bestens. */
    expect(stellen.length).toBeGreaterThanOrEqual(5);
  });

  test("kein Aufruf übergibt einen String als Fehler", () => {
    const verstoesse = stellen.filter(({ argumente }) => /^\s*["'`]/.test(argumente));
    expect(verstoesse.map((v) => `${v.pfad}: ${v.argumente.slice(0, 60)}`)).toEqual([]);
  });

  test("kein Aufruf erfindet ein Kontext-Feld, das der Logger verwirft", () => {
    const verstoesse = [];
    for (const { pfad, argumente } of stellen) {
      const objekt = argumente.slice(argumente.indexOf("{") + 1);
      if (!argumente.includes("{")) continue;
      for (const [, schluessel] of objekt.matchAll(/(?:^|[,{])\s*([A-Za-z_][\w]*)\s*:/g)) {
        if (!ERLAUBTE_FELDER.has(schluessel)) verstoesse.push(`${pfad}: unbekanntes Feld "${schluessel}"`);
      }
    }
    expect(verstoesse).toEqual([]);
  });
});
