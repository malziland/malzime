"use strict";

/**
 * job-helfer.js — die kleinen Entscheidungen im Analyse-Ablauf.
 *
 * HERAUSGELOEST AUS handle-process-job.js am 31.08.2026 (Punkt 3 des
 * Nachtlaufs). Die Datei war auf 680 Zeilen gewachsen und mischte drei Dinge:
 * die Annahme des Auftrags, den Ein-Aufruf-Weg, den Drei-Aufruf-Weg — und
 * dazwischen acht kleine Helfer, die alle drei brauchen.
 *
 * WAS HIER STEHT: Fragen mit einer Antwort. Ist ein Merkmal eingeschaltet?
 * Ist dieser Fehler ein Kontingent-Problem? Wie sieht die Ersatzbeschreibung
 * aus, wenn keine erzeugt wurde?
 *
 * DAS MUSTER "...Safe": Jede Flag-Abfrage faengt ihren eigenen Fehler ab und
 * liefert einen Vorgabewert. Grund: Ein nicht erreichbares Merkmal darf eine
 * laufende Analyse nicht abbrechen — das Kind sieht sonst einen Fehler, weil
 * eine Einstellung nicht gelesen werden konnte. Welcher Vorgabewert richtig
 * ist, steht bei jeder Funktion einzeln.
 */

const {
  isSingleLargeCallEnabled,
  isPromptCacheEnabled,
  isBeastAdsCallEnabled,
  isLiveTextEnabled,
} = require("./feature-flags");

function getMistral() {
  return process.env.MISTRAL_MOCK === "1" ? require("./mistral-mock") : require("./mistral");
}

function isQuotaError(err) {
  return !!(err && (err.code === "rate_limit" || /rate_limit|quota|429/i.test(err.message || "")));
}

function loggeMinorSafety(safety, traceId, lang) {
  console.log(
    JSON.stringify({
      step: "minor-safety",
      traceId: traceId || null,
      lang,
      alter: safety.alter,
      minderjaehrig: safety.minderjaehrig,
      entfernt: safety.entfernt.length,
      gruende: [...new Set(safety.entfernt.map((e) => e.grund))],
      /* Treffer im Fliesstext: nicht entfernt, aber gemeldet — je Stufe. */
      durchgerutscht: safety.durchgerutscht.length,
      durchgerutschtGruende: [...new Set(safety.durchgerutscht.map((d) => d.grund))],
    })
  );

  const harteTreffer = safety.durchgerutscht.filter((d) => d.grund === "immer");
  if (harteTreffer.length) {
    /* Nur Feldnamen, keine Inhalte: Der Einzelfall ist per Design nicht
       rekonstruierbar (Foto geloescht, Job verfaellt). Die Meldung sagt
       allein: die Prompt-Regel haelt nicht mehr — mit Demo-Fotos nachtesten. */
    console.error(
      JSON.stringify({
        step: "minor-safety-durchbruch",
        traceId: traceId || null,
        lang,
        felder: harteTreffer.map((d) => `${d.modus}.${d.feld}`),
      })
    );
  }
}

function buildPseudoDescription(normalProfile) {
  if (!normalProfile) return "";
  const parts = [normalProfile.profileText || ""];
  const cats = normalProfile.categories || {};
  for (const key of Object.keys(cats)) {
    if (cats[key] && cats[key].value) parts.push(cats[key].value);
  }
  return parts.filter(Boolean).join(" ").trim();
}

async function isSingleLargeCallEnabledSafe() {
  try {
    return await isSingleLargeCallEnabled();
  } catch (err) {
    console.log(JSON.stringify({ warning: "single-large-flag-read-error", error: err.message }));
    return false;
  }
}

async function isBeastAdsCallEnabledSafe() {
  try {
    return await isBeastAdsCallEnabled();
  } catch (err) {
    console.log(JSON.stringify({ warning: "beast-ads-flag-read-error", error: err.message }));
    return true;
  }
}

async function isPromptCacheEnabledSafe() {
  try {
    return await isPromptCacheEnabled();
  } catch (err) {
    console.log(JSON.stringify({ warning: "prompt-cache-flag-read-error", error: err.message }));
    return false;
  }
}

async function isLiveTextEnabledSafe() {
  try {
    return await isLiveTextEnabled();
  } catch (err) {
    console.log(JSON.stringify({ warning: "live-text-flag-read-error", error: err.message }));
    return false;
  }
}

/* Hat dieses Profil ueberhaupt Karten? Die Frage steht an mehreren Stellen im
   Ablauf — ein leeres Profil ist kein Fehler, aber auch kein Ergebnis. */
const hasCategories = (obj) => obj && obj.categories && Object.keys(obj.categories).length > 0;

module.exports = {
  isSingleLargeCallEnabledSafe,
  isBeastAdsCallEnabledSafe,
  isPromptCacheEnabledSafe,
  isLiveTextEnabledSafe,
  getMistral,
  isQuotaError,
  buildPseudoDescription,
  loggeMinorSafety,
  hasCategories,
};
