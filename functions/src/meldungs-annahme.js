"use strict";

/**
 * meldungs-annahme.js — was die zwei Annahmestellen fuer Meldungen des
 * Browsers gemeinsam haben (handle-errors.js, handle-telemetry.js).
 *
 * Rumpfpruefung, Wertgrenze und Messwert-Pruefung standen in beiden Dateien
 * als Kopie, und die Kopien waren schon auseinandergelaufen
 * (STRUCT-2026-10-03-56). Hier stehen sie einmal.
 *
 * WAS NICHT HIER STEHT: die Feldlisten. Welche Felder eine Annahmestelle
 * uebernimmt, bleibt bei ihr — das sind die Positivlisten, die der
 * Datenschutztext deckt (`_freigabeliste`, diagnose-freigabeliste.test.js).
 * Dieses Modul uebernimmt nie ein Feld, das ihm die Annahmestelle nicht nennt.
 */

const { checkRateLimit, getClientIp } = require("./middleware");
const { geltendeWerte } = require("./betriebsprofil");

/* BLEIBT IM CODE — Wertgrenze der Diagnose, keine Betriebseinstellung: Jede
   uebernommene Zahl (Dauern in Millisekunden, Groessen) wird auf diesen Wert
   begrenzt. Zehn Minuten sind mehr, als ein Schritt je dauert; die Grenze
   haelt absurde Zahlen aus dem Protokoll. */
const HOECHSTWERT_MS = 600000;

/**
 * Prueft, was vor jeder Uebernahme steht: Methode, Sperre je Adresse, Rumpf.
 * Gibt `{ body }` zurueck — oder `null`, dann ist die Antwort schon gesendet
 * (405, 429 oder 400). Der Rumpf steckt in einer Huelle, weil eine async
 * Funktion ihren Rueckgabewert auf ein Feld `then` abfragt: Der Rumpf selbst
 * wird hier nur dort gelesen, wo die Annahmestelle es verlangt
 * (diagnose-freigabeliste.test.js schreibt jeden Lesezugriff mit).
 *
 * Die Adresse dient nur der Sperre im Arbeitsspeicher; sie wird hier weder
 * gespeichert noch protokolliert (keine-ip-im-protokoll.test.js).
 */
async function rumpfAnnehmen(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return null;
  }

  const ip = getClientIp(req);
  const { werte: grenzwerte } = await geltendeWerte().catch(() => ({ werte: null }));
  if (!checkRateLimit(ip, grenzwerte?.adressLimit, grenzwerte?.adressfensterMs)) {
    res.status(429).json({ error: "Rate limit exceeded" });
    return null;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_) {
      res.status(400).json({ error: "Invalid JSON" });
      return null;
    }
  }
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Invalid body" });
    return null;
  }
  return { body };
}

/**
 * Uebernimmt einfache Felder aus dem Rumpf in `ziel` — nur die, die die
 * Annahmestelle nennt.
 *
 * @param {object} listen
 * @param {Object<string, number>} listen.texte  Feldname → groesste Laenge
 * @param {string[]} listen.zahlen               gerundet, begrenzt
 * @param {string[]} listen.wahrheitswerte
 * @param {number} listen.kleinsteZahl           untere Grenze der Zahlen
 *   (Fehlermeldungen lassen -1 zu, Erfolgsmeldungen beginnen bei 0 — so war
 *   es in beiden Kopien, und so bleibt es)
 */
function einfacheFelder(body, ziel, { texte, zahlen, wahrheitswerte, kleinsteZahl }) {
  for (const [key, maxLen] of Object.entries(texte)) {
    const value = body[key];
    if (typeof value === "string" && value.length > 0) ziel[key] = value.slice(0, maxLen);
  }
  for (const key of zahlen) {
    const value = body[key];
    if (typeof value === "number" && isFinite(value)) {
      ziel[key] = Math.max(kleinsteZahl, Math.min(HOECHSTWERT_MS, Math.round(value)));
    }
  }
  for (const key of wahrheitswerte) {
    if (typeof body[key] === "boolean") ziel[key] = body[key];
  }
}

/**
 * Die Messwerte einer Meldung (`timings`): nur die Schluessel aus `erlaubt`,
 * gerundet, zwischen 0 und der Wertgrenze. `null`, wenn keiner uebrig bleibt.
 */
function messwerte(raw, erlaubt) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const key of erlaubt) {
    const v = raw[key];
    if (typeof v === "number" && isFinite(v)) out[key] = Math.max(0, Math.min(HOECHSTWERT_MS, Math.round(v)));
  }
  return Object.keys(out).length > 0 ? out : null;
}

module.exports = { rumpfAnnehmen, einfacheFelder, messwerte, HOECHSTWERT_MS };
