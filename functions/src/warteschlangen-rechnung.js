"use strict";

/**
 * warteschlangen-rechnung.js — wie viel die Warteschlange schafft.
 *
 * DIE EINE STELLE fuer die Rechnung, aus der Einlassgrenze (handle-enqueue.js)
 * und Wartezeit-Ansage (handle-job-status.js) entstehen (BUG-2026-10-03-35).
 * Vorher stand sie an zwei Orten, und beide rechneten nur mit einer der zwei
 * Bremsen.
 *
 * ZWEI BREMSEN, es gilt die engere:
 *   - `parallelitaet`: so viele Analysen laufen gleichzeitig. Bei einer Dauer
 *     von d Sekunden sind das parallelitaet / d Analysen je Sekunde.
 *   - `queueRatePerSekunde`: so viele Auftraege schickt die Warteschlange je
 *     Sekunde los, egal wie schnell die KI ist.
 * Wird die KI schneller oder aendert jemand nur einen der beiden Werte,
 * entscheidet die Rate — das uebersah die alte Rechnung.
 */

const { dauerJeAnalyse } = require("./durchsatz");
const { getFeatureFlags } = require("./feature-flags");

/* BLEIBT IM CODE — Rechenhilfe, keine Betriebsgroesse. Schwebezahlen:
   1800 × 0,1 × 0,8 ergibt 144,00000000000003, andere Paare landen knapp UNTER
   der ganzen Zahl. Ohne diesen Zuschlag schnitte das Abrunden dort einen Platz
   zu viel ab. */
const RUNDUNGSLUFT = 1e-9;

/**
 * Wie viele Wartende in einer halben Stunde zu schaffen sind — mit 20 %
 * Abschlag, mindestens 1. Die halbe Stunde ist die Geduld des Browsers.
 */
function einlassgrenzeAus(werte, sekundenJeAnalyse) {
  const halbeStunde = 30 * 60;
  const ueberParallelitaet = (halbeStunde / sekundenJeAnalyse) * werte.parallelitaet * 0.8;
  const ueberRate = halbeStunde * werte.queueRatePerSekunde * 0.8;
  return Math.max(1, Math.floor(Math.min(ueberParallelitaet, ueberRate) + RUNDUNGSLUFT));
}

/**
 * Wartezeit in Sekunden fuer eine Position in der Warteschlange: die LAENGERE
 * von zwei Rechnungen, also die mit der engeren Bremse. Ueber die
 * Parallelitaet in ganzen Runden (wie bisher), ueber die Rate geradeaus.
 */
function wartezeitSekunden(werte, position, sekundenJeAnalyse) {
  const ueberParallelitaet = Math.ceil(position / werte.parallelitaet) * sekundenJeAnalyse;
  const ueberRate = Math.ceil(position / werte.queueRatePerSekunde - RUNDUNGSLUFT);
  return Math.max(ueberParallelitaet, ueberRate);
}

/* Die Einlassgrenze, die JETZT gilt.

   Die Rechnung braucht die gemessene Dauer einer Analyse (`stats/durchsatz`,
   laufend aus echten Laeufen fortgeschrieben) und die beiden Bremsen aus dem
   Einstellungssatz, den der Aufrufer hereinreicht.

   BEFUND ARCH-2026-08-30-01 (Kurz-Audit): Die Parallelitaet stammte hier
   weiterhin aus dem Code. Wer den Einstellungssatz auf einen groesseren Tarif
   umstellte, sah im Zahlen-Endpunkt "quelle: firestore" und hielt alles fuer
   umgestellt — die Einlassgrenze rechnete aber weiter mit dem alten Wert. Das
   waere erst im Workshop unter Last aufgefallen, ohne Signal.

   Faellt die Messung aus oder ist sie veraltet, gilt `warteschlangeTiefe` aus
   dem Einstellungssatz; ohne Satz ist die Einlassgrenze null. Eine Konstante
   im Code gibt es seit 30.08.2026 nicht mehr: Die Einlassgrenze darf nie
   fehlen, aber auch nie aus einer zweiten Quelle kommen. */
async function einlassgrenzeFuer(werte) {
  /* Ohne Einstellungssatz laeuft ohnehin keine Analyse — dann ist die
     ehrliche Einlassgrenze null, nicht eine Ersatzzahl aus dem Code. */
  if (!werte) return 0;
  try {
    const flags = await getFeatureFlags();
    const { sekunden, gemessen, frisch } = await dauerJeAnalyse(flags.useGemesseneDauer === true);
    /* Gemessene Dauer verfuegbar UND frisch: Grenze daraus rechnen, sonst die
       Zahl aus dem Einstellungssatz nehmen. Veraltete Messwerte (aelter als
       eine Woche) zaehlen nicht — dieselbe Regel wie bei der Wartezeit-Ansage
       (OPS-2026-10-03-25). */
    if (!gemessen || !frisch || !sekunden) return werte.warteschlangeTiefe;
    return einlassgrenzeAus(werte, sekunden);
  } catch (_) {
    return werte.warteschlangeTiefe;
  }
}

module.exports = { einlassgrenzeAus, wartezeitSekunden, einlassgrenzeFuer };
