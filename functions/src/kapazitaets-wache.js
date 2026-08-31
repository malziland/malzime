"use strict";

/**
 * kapazitaets-wache.js — Merkt, wenn Code und echte Warteschlange auseinanderlaufen.
 *
 * WARUM ES DIESE WACHE GIBT:
 *
 * Die Zahl "wie viele Analysen duerfen gleichzeitig laufen" existiert ZWEIMAL:
 * einmal als `QUEUE_DISPATCH_CONCURRENCY` im Code, einmal als
 * `maxConcurrentDispatches` in der Cloud-Tasks-Warteschlange bei Google. Der
 * Code rechnet damit die Wartezeit und die Einlassgrenze aus; Google
 * entscheidet damit, was tatsaechlich passiert.
 *
 * Stehen die beiden nicht auf demselben Wert, rechnet die Seite still falsch.
 * Sagt der Code 7 und die Warteschlange laeuft auf 3, versprechen wir eine
 * Wartezeit, die wir nicht halten koennen — und lassen mehr Leute ein, als wir
 * bedienen. Sagt der Code 3 und die Warteschlange laeuft auf 7, verschenken wir
 * mehr als die Haelfte der Kapazitaet.
 *
 * Dass es fuer das Umstellen DREI Skripte gibt (cloudtasks-concurrency-3/7/10),
 * ist der Beweis: Die Kopplung existiert und ist heute Handarbeit. Wer beim
 * Tarifwechsel eines der beiden vergisst, merkt es an nichts.
 *
 * BEWUSST NUR EINE MELDUNG, KEINE AUTOMATIK. Cloud Tasks ist ein fremdes
 * System. Es aus unserem Code heraus umzustellen hiesse, eine Aenderung an der
 * Infrastruktur ohne Pruefkette und ohne Freigabe vorzunehmen. Die Wache liest
 * und meldet — gehandelt wird von Hand, mit den vorhandenen Skripten.
 */

const { QUEUE_NAME, QUEUE_REGION, isLocalQueueMode } = require("./config");
const { geltendeWerte } = require("./betriebsprofil");

let clientOverride = null;

/* Fuer Tests ersetzbar — kein Test braucht echte GCP-Zugaenge. */
function setClientForTest(c) {
  clientOverride = c;
}

function getClient() {
  if (clientOverride) return clientOverride;
  const { CloudTasksClient } = require("@google-cloud/tasks");
  return new CloudTasksClient();
}

function projectId() {
  return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
}

/**
 * Liest den echten `maxConcurrentDispatches` der Warteschlange.
 * Gibt `null` zurueck, wenn er nicht ermittelbar ist — das ist ausdruecklich
 * KEIN Befund, sondern "nicht messbar". Eine Wache, die bei einem Lesefehler
 * Alarm schlaegt, meldet Netzwerkstoerungen als Fehlkonfiguration.
 */
async function echteParallelitaet() {
  if (isLocalQueueMode && isLocalQueueMode()) return null;
  const pid = projectId();
  if (!pid) return null;
  try {
    const client = getClient();
    const name = client.queuePath(pid, QUEUE_REGION, QUEUE_NAME);
    const [queue] = await client.getQueue({ name });
    const wert = queue?.rateLimits?.maxConcurrentDispatches;
    return typeof wert === "number" && wert > 0 ? wert : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Liest die echte Rate der Warteschlange (Auftraege pro Sekunde).
 *
 * VORFALL 31.08.2026: Die Wache pruefte nur die Parallelitaet. Als ein
 * Testlauf die Queue auf 7/0,5 stellte (Satz: 4/0,125), meldete sie zwar die
 * Parallelitaet — die RATE, also das eigentliche Problem, sah sie nicht. Mit
 * 0,5 statt 0,125 lief die Auslieferung auf VIERFACHEM Tempo gegen Mistrals
 * Grenze; am Morgen kamen die ersten Ueberlastmeldungen.
 */
async function echteRate() {
  if (isLocalQueueMode && isLocalQueueMode()) return null;
  const pid = projectId();
  if (!pid) return null;
  try {
    const client = getClient();
    const name = client.queuePath(pid, QUEUE_REGION, QUEUE_NAME);
    const [queue] = await client.getQueue({ name });
    const wert = queue?.rateLimits?.maxDispatchesPerSecond;
    return typeof wert === "number" && wert > 0 ? wert : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Vergleicht den Code-Wert mit dem echten Wert.
 * Reine Rechnung, damit sie ohne Netzwerk pruefbar ist.
 */
function bewerte(imCode, inDerQueue) {
  if (inDerQueue === null || inDerQueue === undefined) {
    return { auffaellig: false, grund: "nicht-messbar", zahlen: { imCode, inDerQueue: null } };
  }
  if (imCode === inDerQueue) {
    return { auffaellig: false, grund: "stimmt-ueberein", zahlen: { imCode, inDerQueue } };
  }
  /* Welche Richtung? Beides ist schaedlich, aber unterschiedlich.
     BEFUND 31.08.2026: Hier stand "kapazitaet-verschenkt", wenn die Queue MEHR
     erlaubt als der Satz. Das klang nach ungenutztem Potenzial — tatsaechlich
     laeuft die Auslieferung dann schneller, als die KI-Stufe zulaesst, und
     erzeugt Ueberlastmeldungen. Genau so ist es an diesem Tag passiert. */
  const richtung = imCode > inDerQueue ? "code-verspricht-zu-viel" : "queue-laeuft-zu-schnell";
  return { auffaellig: true, grund: richtung, zahlen: { imCode, inDerQueue } };
}

function baueMeldung(befund) {
  const { imCode, inDerQueue } = befund.zahlen;
  if (befund.grund === "code-verspricht-zu-viel") {
    return (
      `Kapazitaet laeuft auseinander: Der Code rechnet mit ${imCode} gleichzeitigen ` +
      `Analysen, die Warteschlange laesst aber nur ${inDerQueue} zu. Wartezeit-Ansage und ` +
      `Einlassgrenze sind damit zu optimistisch — wer hinten einreiht, wartet umsonst. ` +
      `Abhilfe: scripts/cloudtasks-concurrency-${imCode}.sh, oder parallelitaet im Einstellungssatz ` +
      `auf ${inDerQueue} senken.`
    );
  }
  return (
    `ACHTUNG: Die Warteschlange laeuft SCHNELLER als eingestellt. Sie erlaubt ` +
    `${inDerQueue} gleichzeitige Analysen, der Einstellungssatz sagt ${imCode}. ` +
    `Damit gehen mehr Aufrufe an die KI, als ihre Stufe zulaesst — es drohen ` +
    `Ueberlastmeldungen bei echten Nutzern. ` +
    `Abhilfe: ./scripts/warteschlange-pruefen.sh --setzen ` +
    `(zieht die Warteschlange auf den Einstellungssatz nach). ` +
    `NICHT den Satz anheben, ohne vorher ins Mistral-Dashboard zu sehen.`
  );
}

/**
 * Einstiegspunkt fuer den taeglichen Lauf.
 * Gibt den Befund zurueck; das Melden uebernimmt der Aufrufer (wie bei der
 * Laufzeit-Wache), damit diese Datei ohne Benachrichtigungs-Kanaele testbar
 * bleibt.
 */
async function pruefeKapazitaet() {
  const inDerQueue = await echteParallelitaet();
  /* Der Sollwert kommt aus dem Einstellungssatz — die Wache soll gegen das
     pruefen, was heute gilt, nicht gegen eine Zahl im Quelltext. */
  const { werte } = await geltendeWerte();
  if (!werte) {
    console.error(
      JSON.stringify({ step: "kapazitaets-wache", grund: "kein Einstellungssatz — kein Abgleich moeglich" })
    );
    return { gemeldet: false, grund: "kein-einstellungssatz" };
  }
  const befund = bewerte(werte.parallelitaet, inDerQueue);
  return { ...befund, meldung: befund.auffaellig ? baueMeldung(befund) : null };
}

module.exports = {
  pruefeKapazitaet,
  echteParallelitaet,
  setClientForTest,
  /* Fuer Tests */
  _bewerte: bewerte,
  _baueMeldung: baueMeldung,
};
