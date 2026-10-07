"use strict";

const util = require("util");

/* Ein Argument einer Konsolenausgabe als Text, in dem sein INHALT steht
   (TEST-2026-10-04-15): Text bleibt Text; ein Objekt wird als JSON geschrieben,
   ein Fehler mit Meldung, Stapel und eigenen Feldern. `String(objekt)` ergaebe
   "[object Object]" — die Suche nach dem Wert einer Kennung saehe nicht hinein,
   und eine Zusicherung "die Auftragsnummer steht nirgends" waere blind.
   Was sich nicht als JSON schreiben laesst (ein Objekt, das sich selbst
   enthaelt), klappt util.inspect auf. */
function alsText(wert) {
  if (wert === null || typeof wert !== "object") return String(wert);
  if (wert instanceof Error) return `${wert.stack || wert.message} ${alsText({ ...wert })}`;
  try {
    return JSON.stringify(wert);
  } catch (_) {
    return util.inspect(wert, { depth: null, maxArrayLength: null, maxStringLength: null, breakLength: Infinity });
  }
}

/** Alle Argumente EINER Konsolenausgabe als eine Zeile. */
const zeileAlsText = (...argumente) => argumente.map(alsText).join(" ");

module.exports = { alsText, zeileAlsText };
