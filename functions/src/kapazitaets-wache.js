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
const { datenbank } = require("./db");

/* BEFUND 01.09.2026 (Pruefrunde 8, N-P3a): Ein Lauf, der nichts messen kann,
   ging als `console.log` hinaus — unterhalb der Alarmschwelle. Die
   Begruendung dafuer war richtig (eine Netzstoerung ist keine
   Fehlkonfiguration), die Folge aber nicht: Diese Wache konnte DAUERHAFT
   blind sein, und niemand haette es erfahren. Sie ist wegen des Vorfalls vom
   31.08. gebaut worden — eine blinde Wache ist dort das eigentliche Risiko.

   Dieselbe Loesung wie bei der Schwester in laufzeit-wache.js: Der Zustand
   wird ueber Tage gezaehlt. Ein einzelner Ausfall bleibt eine Logzeile; haelt
   er an, wird daraus eine ERROR-Zeile, die die Alarmierung erreicht. */
const ZUSTAND_DOKUMENT = "stats/kapazitaets-wache";
/* Erst nach so vielen Tagen ohne Messung geht eine ERROR-Zeile raus — wie
   ANHALTEND_TAGE bei der Schwester-Wache. Eine Auswertungsregel, keine
   Stellschraube des Betriebs: Wer sie aendert, aendert nicht, wie schnell
   analysiert wird, sondern ab wann ein Ausfall laut wird. */
const BLIND_TAGE = 2;

let clientOverride = null;

/* Fuer Tests ersetzbar — kein Test braucht echte GCP-Zugaenge. */
function setClientForTest(c) {
  clientOverride = c;
}

function getClient() {
  if (clientOverride) return clientOverride;
  /* OPS-2026-08-31-21 (Runde 3, von zwei Pruefern gefunden): Dies ist ein
     ZWEITER Cloud-Tasks-Client, unabhaengig von dem in cloud-tasks.js — und
     er hatte dessen Riegel nicht. Ausgefuehrt: unter JEST_WORKER_ID=1 und
     unter FUNCTIONS_EMULATOR=true erzeugte er einen echten Client gegen die
     Produktions-Warteschlange.

     Die Wache LIEST nur (getQueue), richtet also nichts an. Trotzdem gehoert
     der Riegel hierher: Sonst haengt die Sicherheit daran, dass niemand
     spaeter einen schreibenden Aufruf ergaenzt. */
  if (process.env.JEST_WORKER_ID !== undefined) {
    throw new Error("Cloud-Tasks-Zugriff aus einem Test ohne Attrappe — setClientForTest() verwenden.");
  }
  const emulator =
    process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR || process.env.CLOUD_TASKS_EMULATOR_HOST;
  if (emulator) {
    throw new Error("Es laeuft ein Emulator — die echte Warteschlange wird nicht gelesen.");
  }
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
/* BEFUND 01.09.2026 (Pruefrunde 8, N-P3b): `echteParallelitaet` und
   `echteRate` holten die GLEICHE Antwort zweimal und lasen daraus je ein
   anderes Feld — zwei Netzabfragen fuer einen Datensatz, und vor allem zwei
   Stellen, die auseinanderlaufen koennen. Genau das war schon passiert: Die
   eine hatte `catch (e)` mit Grundfestschreibung, die andere `catch (_e)`
   ohne (Befund H-11 der Runde 5). Ab jetzt gibt es eine Lesestelle. */
async function warteschlangeLesen() {
  if (isLocalQueueMode && isLocalQueueMode()) return null;
  const pid = projectId();
  if (!pid) return null;
  try {
    const client = getClient();
    const name = client.queuePath(pid, QUEUE_REGION, QUEUE_NAME);
    const [queue] = await client.getQueue({ name });
    return queue?.rateLimits ?? {};
  } catch (e) {
    letzterLesefehler = e && e.message ? e.message : String(e);
    return null;
  }
}

/** Ein Wert gilt nur als Messung, wenn er eine Zahl groesser null ist. */
function alsMesswert(wert) {
  return typeof wert === "number" && wert > 0 ? wert : null;
}

async function echteParallelitaet() {
  const grenzen = await warteschlangeLesen();
  if (!grenzen) return null;
  return alsMesswert(grenzen.maxConcurrentDispatches);
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
/* Der Grund des letzten gescheiterten Lesevorgangs. Nur fuer die Meldung —
   die Wache selbst entscheidet weiterhin nur anhand der Zahlen. */
let letzterLesefehler = null;

async function echteRate() {
  const grenzen = await warteschlangeLesen();
  if (!grenzen) return null;
  return alsMesswert(grenzen.maxDispatchesPerSecond);
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
    /* OPS-2026-08-31-22: Dieselbe Meldung diente fuer Parallelitaet UND Rate.
       Bei der Rate stand dann "Sie erlaubt 0.5 gleichzeitige Analysen" — eine
       Rate pro Sekunde als Anzahl ausgegeben. Der Aufrufer stellt der Meldung
       "RATE:" bzw. "PARALLELITAET:" voran; der Wortlaut passt jetzt zu beidem. */
    `den Wert ${inDerQueue}, der Einstellungssatz sagt ${imCode}. ` +
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
  /* Vor jedem Lauf zuruecksetzen: Sonst haengt der Grund eines EINMALIGEN
     Fehlschlags dauerhaft in den Meldungen und sieht aus wie ein anhaltendes
     Problem (Befund H-11, Runde 5). */
  letzterLesefehler = null;
  const inDerQueue = await echteParallelitaet();
  /* OPS-2026-08-31-07: Auch die RATE messen. Sie bestimmt, wie schnell
     Aufrufe an die KI gehen, und war beim Vorfall vom 31.08. die verstellte
     Groesse (0,5/s statt 0,125/s). Bis hierher war `echteRate` zwar
     geschrieben, wurde aber nie aufgerufen — die Wache haette eine allein
     verstellte Rate nicht bemerkt. */
  const rateInDerQueue = await echteRate();
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
  const rateBefund = bewerte(werte.queueRatePerSekunde, rateInDerQueue);
  /* Auffaellig ist der Lauf, wenn EINE der beiden Groessen auseinanderlaeuft.
     Gemeldet wird die gefaehrlichere zuerst: eine zu schnelle Warteschlange
     erzeugt Ueberlastmeldungen bei echten Nutzern, ein zu optimistischer Code
     nur falsche Wartezeit-Ansagen. */
  const auffaellige = [befund, rateBefund].filter((b) => b.auffaellig);
  if (!auffaellige.length) {
    /* BEFUND 31.08.2026 (Runde 3): Ein Lauf, der NICHTS messen konnte, sah
       genauso aus wie einer, bei dem alles stimmt — beide "unauffaellig",
       beide ohne Meldung. Die Wache konnte dauerhaft blind sein, ohne dass es
       jemandem auffiel. Sie ist wegen des Vorfalls vom 31.08. gebaut worden.
       Alarm gibt es hier bewusst weiterhin nicht (eine Netzwerkstoerung ist
       keine Fehlkonfiguration) — aber die Logzeile sagt jetzt, WARUM nicht
       gemessen werden konnte. Wer im Protokoll dieselbe Zeile jeden Tag sieht,
       erkennt eine dauerhaft blinde Wache. */
    const nichtGemessen = [befund, rateBefund].filter((b) => b.grund === "nicht-messbar");
    if (nichtGemessen.length) {
      const heute = new Date().toISOString().slice(0, 10);
      let blindSeit = heute;
      let zustandLesbar = true;
      try {
        const snap = await datenbank().doc(ZUSTAND_DOKUMENT).get();
        if (snap.exists && snap.data() && snap.data().blindSeit) blindSeit = snap.data().blindSeit;
      } catch (_fehler) {
        /* Der Grund selbst hilft hier nicht weiter — gemeldet wird, DASS der
           Zustand unlesbar ist, und das steht unten in der ERROR-Zeile. */
        zustandLesbar = false;
      }
      const tage = Math.round((Date.parse(heute) - Date.parse(blindSeit)) / 86400000) + 1;
      const zeile = {
        step: "kapazitaets-wache",
        status: "nicht-messbar",
        betroffen: nichtGemessen.map((b) => (b === rateBefund ? "rate" : "parallelitaet")),
        lesefehler: letzterLesefehler,
        blindSeit,
        tage,
      };
      if (tage >= BLIND_TAGE || !zustandLesbar) {
        /* Anhaltend blind — oder der Zustand selbst unlesbar, dann laesst sich
           die Dauer gar nicht bestimmen. Beides gehoert gemeldet. */
        console.error(
          JSON.stringify({
            ...zeile,
            severity: "ERROR",
            hinweis: zustandLesbar
              ? `Die Wache kann seit ${tage} Tagen nicht messen. Sie ist blind — von Hand nachsehen.`
              : "Die Wache kann nicht messen UND ihren eigenen Zustand nicht lesen.",
          })
        );
      } else {
        console.log(
          JSON.stringify({
            ...zeile,
            hinweis: "Einmalig nicht messbar. Haelt es an, folgt eine ERROR-Zeile.",
          })
        );
      }
      try {
        await datenbank().doc(ZUSTAND_DOKUMENT).set({ blindSeit }, { merge: true });
      } catch (_) {
        /* still — der Ausfall ist oben schon gemeldet */
      }
    } else {
      /* Wieder messbar: Zaehler zuruecksetzen, sonst entsteht Dauerrot. */
      try {
        await datenbank().doc(ZUSTAND_DOKUMENT).set({ blindSeit: null }, { merge: true });
      } catch (_) {
        /* still */
      }
    }
    return { ...befund, rate: rateBefund, meldung: null };
  }
  const meldungen = auffaellige.map((b) =>
    b === rateBefund ? `RATE: ${baueMeldung(b)}` : `PARALLELITAET: ${baueMeldung(b)}`
  );
  const fuehrend = auffaellige.find((b) => b.grund === "queue-laeuft-zu-schnell") || auffaellige[0];
  return { ...fuehrend, rate: rateBefund, parallelitaet: befund, meldung: meldungen.join("\n\n") };
}

module.exports = {
  pruefeKapazitaet,
  echteParallelitaet,
  echteRate,
  setClientForTest,
  /* Fuer Tests */
  _bewerte: bewerte,
  /* Nur fuer die Riegel-Probe: gibt getClient unveraendert nach aussen. */
  _getClientFuerTest: () => getClient(),
  _baueMeldung: baueMeldung,
};
