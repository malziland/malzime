"use strict";

/**
 * db.js — die EINZIGE Stelle, an der eine Firestore-Verbindung entsteht.
 *
 * Hintergrund (Audit 2026-08-10, PRIV-001): Die Datenschutzerklärung verspricht
 * Europa, die ursprüngliche Datenbank liegt aber in `nam5` (USA). Der Standort
 * einer Firestore-Datenbank steht bei der Erstellung fest und lässt sich nie
 * ändern — der Wechsel läuft deshalb über eine zweite Datenbank in
 * `europe-west1`, ausgewählt über `FIRESTORE_DATABASE_ID` in `config.js`.
 *
 * Warum eine zentrale Stelle: Vorher rief jede Datei `getFirestore()` direkt
 * auf — 22 Stellen in vier Dateien. Beim Umschalten hätte eine übersehene
 * Stelle stillschweigend weiter in die alte Datenbank geschrieben, ohne Fehler,
 * ohne Log, ohne dass es jemandem auffällt. Genau diese Art Lücke ist der
 * Grund, warum die Zusage „Daten in Europa" drei Audits lang unbemerkt falsch
 * war. Ein direkter `getFirestore()`-Aufruf ausserhalb dieser Datei lässt
 * deshalb `__tests__/db-zentral.test.js` rot werden.
 *
 * Der Name ist bewusst `datenbank()` und nicht `db()`: In jobs.js und counter.js
 * gibt es bereits lokale Variablen `const db = …`. Ein gleichnamiger Import
 * würde dort still überlagert oder — bei `const db = db()` — als Fehler enden.
 */

const { getFirestore } = require("firebase-admin/firestore");
const { FIRESTORE_DATABASE_ID } = require("./config");

/**
 * Liefert die Firestore-Instanz der konfigurierten Datenbank.
 *
 * Leerer Bezeichner heisst „Standard-Datenbank" — dafür MUSS `getFirestore()`
 * ohne Argument aufgerufen werden; `getFirestore("")` ist kein gültiger Aufruf.
 *
 * Kein eigener Zwischenspeicher: Das Admin-SDK gibt für denselben Bezeichner
 * ohnehin dieselbe Instanz zurück. Ein Cache hier würde nur verhindern, dass
 * Tests den Schalter zwischen zwei Fällen umlegen können.
 */
function datenbank() {
  return FIRESTORE_DATABASE_ID ? getFirestore(FIRESTORE_DATABASE_ID) : getFirestore();
}

/**
 * Welche Datenbank gerade aktiv ist — für Logzeilen und den Smoke-Test nach
 * dem Umschalten. Gibt einen sprechenden Namen zurück, keinen leeren String.
 */
function aktiveDatenbank() {
  return FIRESTORE_DATABASE_ID || "(default)";
}

module.exports = { datenbank, aktiveDatenbank };
