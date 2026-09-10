"use strict";

/**
 * job-helfer.js — die kleinen Entscheidungen im Analyse-Ablauf.
 *
 * HERAUSGELOEST AUS handle-process-job.js am 31.08.2026 (Punkt 3 des
 * Nachtlaufs). Die Datei war auf 680 Zeilen gewachsen und mischte die Annahme
 * des Auftrags, die beiden damaligen Analysewege und die kleinen Helfer, die
 * beide brauchten. (Der Drei-Aufruf-Weg ist seit 10.09.2026 ausgebaut.)
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

const { isBeastAdsCallEnabled } = require("./feature-flags");

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
      /* PRIV-2026-09-10-02: BEWUSST OHNE Vorgangskennung (traceId). Diese
         Zeile liegt 30 Tage im Diagnose-Speicher `client-diagnostics`, und
         dort tragen die Browser-Meldungen (client-error, client-telemetry)
         dieselbe Kennung samt Geraeteklasse. Mit ihr liesse sich die
         Altersschaetzung einer Analyse mit dem Geraet verbinden — im Workshop
         fuehren Uhrzeit und Geraet auf ein bestimmtes Kind. Die Durchbruch-
         Zeile unten behaelt die Kennung: Sie geht nicht in den 30-Tage-
         Speicher (Filter vergleicht step exakt) und traegt kein Alter. */
      lang,
      alter: safety.alter,
      minderjaehrig: safety.minderjaehrig,
      entfernt: safety.entfernt.length,
      gruende: [...new Set(safety.entfernt.map((e) => e.grund))],
      /* Treffer im Fliesstext: nicht entfernt, aber gemeldet — je Stufe. */
      durchgerutscht: safety.durchgerutscht.length,
      durchgerutschtGruende: [...new Set(safety.durchgerutscht.map((d) => d.grund))],
      /* Seit 09.09.2026 je Treffer: Feld und das getroffene Wort aus der
         festen Sperrliste — nie der Satz, nie der Werbetext. Damit sagt die
         naechste Zeile selbst, ob "cocktail" in einer Bar-Beschreibung stand
         oder "sportwetten" als Werbeidee fuer ein Kind. Und die Anzahl der
         Werbeeintraege je Modus, wie das Kind sie sieht. */
      entfernte: safety.entfernt.map((e) => ({ feld: `${e.modus}.${e.feld}`, grund: e.grund, stichwort: e.stichwort })),
      durchgerutschte: safety.durchgerutscht.map((d) => ({
        feld: `${d.modus}.${d.feld}`,
        grund: d.grund,
        stichwort: d.stichwort,
      })),
      werbung: safety.werbung || {},
      gekappt: (safety.gekappt || []).length,
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

async function isBeastAdsCallEnabledSafe() {
  try {
    return await isBeastAdsCallEnabled();
  } catch (err) {
    console.log(JSON.stringify({ warning: "beast-ads-flag-read-error", error: err.message }));
    return true;
  }
}

/* Hat dieses Profil ueberhaupt Karten? Die Frage steht an mehreren Stellen im
   Ablauf — ein leeres Profil ist kein Fehler, aber auch kein Ergebnis. */
const hasCategories = (obj) => obj && obj.categories && Object.keys(obj.categories).length > 0;

module.exports = {
  isBeastAdsCallEnabledSafe,
  getMistral,
  isQuotaError,
  buildPseudoDescription,
  loggeMinorSafety,
  hasCategories,
};
