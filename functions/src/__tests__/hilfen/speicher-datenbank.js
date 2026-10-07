"use strict";

/* Eine Datenbank im Arbeitsspeicher fuer Tests, die mehrere echte Module
   zusammen laufen lassen (Einlass, Auftragsverwaltung, Aufraeumdienst).

   Nachgebildet ist nur, was diese Module benutzen: Dokumente lesen, schreiben,
   aendern, loeschen; Abfragen mit Gleichheit und Ungleichheit, Obergrenze und
   Zaehlung; Transaktionen (nacheinander, ohne Sperren). Wie bei Firestore
   fallen Dokumente ohne Wert aus einer Ungleichheits-Abfrage heraus.

   Einbinden (die Fabrik von jest.mock darf nur `require` benutzen):

     jest.mock("../db", () => ({ datenbank: () => require("./hilfen/speicher-datenbank").datenbank }));
     const speicher = require("./hilfen/speicher-datenbank");

   Stoerungen: `speicher.vor(fn)` haengt eine Funktion vor jeden Zugriff. Sie
   bekommt `{ art, pfad, daten }` (art: get | set | update | delete | abfrage |
   zaehlen | transaktion | transaktion-ende) und darf werfen oder ein Promise
   zurueckgeben, auf das der Zugriff dann wartet. "transaktion-ende" kommt, wenn
   die Transaktion schon geschrieben hat. `speicher.leeren()` nimmt Dokumente und Stoerungen
   wieder weg. */

const dokumente = new Map();
let stoerungen = [];
let laufendeNummer = 0;
/* Jeder Zugriff in der Reihenfolge, in der er BEGANN — fuer Pruefungen der Art
   "war das geschrieben, bevor die Antwort hinausging?". */
const protokoll = [];

async function zugriff(art, pfad, daten) {
  protokoll.push({ art, pfad });
  for (const fn of stoerungen) await fn({ art, pfad, daten });
}

function passt(daten, bedingung) {
  const wert = daten[bedingung.feld];
  if (bedingung.op === "==") return wert === bedingung.wert;
  if (wert === null || wert === undefined) return false;
  if (bedingung.op === "<") return wert < bedingung.wert;
  if (bedingung.op === "<=") return wert <= bedingung.wert;
  if (bedingung.op === ">") return wert > bedingung.wert;
  if (bedingung.op === ">=") return wert >= bedingung.wert;
  throw new Error(`Vergleich "${bedingung.op}" ist in dieser Attrappe nicht nachgebildet`);
}

function dokument(pfad) {
  const id = pfad.split("/").pop();
  const ref = {
    id,
    pfad,
    async get() {
      await zugriff("get", pfad);
      const daten = dokumente.get(pfad);
      return { exists: daten !== undefined, id, ref, data: () => (daten === undefined ? undefined : { ...daten }) };
    },
    async set(daten) {
      await zugriff("set", pfad, daten);
      dokumente.set(pfad, { ...daten });
    },
    async update(aenderung) {
      await zugriff("update", pfad, aenderung);
      if (!dokumente.has(pfad)) throw new Error("update auf ein fehlendes Dokument");
      dokumente.set(pfad, { ...dokumente.get(pfad), ...aenderung });
    },
    async delete() {
      await zugriff("delete", pfad);
      dokumente.delete(pfad);
    },
  };
  return ref;
}

function abfrage(sammlung, bedingungen, grenze) {
  const treffer = () => {
    let liste = [...dokumente.entries()].filter(
      ([pfad, daten]) => pfad.startsWith(`${sammlung}/`) && bedingungen.every((b) => passt(daten, b))
    );
    if (grenze != null) liste = liste.slice(0, grenze);
    return liste;
  };
  return {
    where: (feld, op, wert) => abfrage(sammlung, [...bedingungen, { feld, op, wert }], grenze),
    limit: (n) => abfrage(sammlung, bedingungen, n),
    async get() {
      await zugriff("abfrage", sammlung);
      const docs = treffer().map(([pfad, daten]) => ({
        id: pfad.split("/").pop(),
        ref: dokument(pfad),
        data: () => ({ ...daten }),
      }));
      return { docs, empty: docs.length === 0 };
    },
    count: () => ({
      async get() {
        await zugriff("zaehlen", sammlung);
        const anzahl = treffer().length;
        return { data: () => ({ count: anzahl }) };
      },
    }),
  };
}

const datenbank = {
  doc: (pfad) => dokument(pfad),
  collection: (sammlung) => ({
    doc: (id) => dokument(`${sammlung}/${id === undefined ? `auto-${++laufendeNummer}` : id}`),
    where: (feld, op, wert) => abfrage(sammlung, [{ feld, op, wert }]),
    limit: (n) => abfrage(sammlung, [], n),
    get: () => abfrage(sammlung, []).get(),
    count: () => abfrage(sammlung, []).count(),
  }),
  async runTransaction(fn) {
    await zugriff("transaktion", null);
    const ergebnis = await fn({
      get: (ref) => ref.get(),
      update: (ref, aenderung) => {
        if (!dokumente.has(ref.pfad)) throw new Error("update auf ein fehlendes Dokument");
        dokumente.set(ref.pfad, { ...dokumente.get(ref.pfad), ...aenderung });
      },
      set: (ref, daten) => {
        dokumente.set(ref.pfad, { ...daten });
      },
    });
    /* Hier ist schon geschrieben. Eine Stoerung an dieser Stelle stellt den Fall
       nach, dass die Bestaetigung der Datenbank nicht mehr ankommt. */
    await zugriff("transaktion-ende", null);
    return ergebnis;
  },
};

module.exports = {
  datenbank,
  /* Direkter Blick in den Speicher, ohne Zugriff zu zaehlen oder zu stoeren. */
  lies: (pfad) => (dokumente.has(pfad) ? { ...dokumente.get(pfad) } : undefined),
  lege: (pfad, daten) => dokumente.set(pfad, { ...daten }),
  pfade: (sammlung) => [...dokumente.keys()].filter((pfad) => pfad.startsWith(`${sammlung}/`)),
  vor: (fn) => stoerungen.push(fn),
  protokoll,
  leeren() {
    dokumente.clear();
    stoerungen = [];
    laufendeNummer = 0;
    protokoll.length = 0;
  },
};
