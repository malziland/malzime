"use strict";

/**
 * jobs.js — Job-Verwaltung für die Queue-Architektur (v2.0).
 *
 * Jede Analyse-Anfrage wird im Queue-Modus als Job-Dokument in der Firestore-
 * Collection `jobs` abgelegt. Lebenszyklus:
 *
 *   queued ──(Worker übernimmt)──► processing ──► done | failed
 *   queued ──(Client verlässt die Seite)──────────────────► abandoned
 *
 * - `enqueue`-Handler legt den Job an (Status `queued`) und reiht ihn in
 *   Cloud Tasks ein.
 * - Cloud Tasks dispatcht ihn dosiert an `process-job`, der `claimJob` ruft,
 *   die Mistral-Pipeline ausführt und `completeJob`/`failJob` ruft.
 * - `job-status`-Handler liest den Job für den pollenden Client und
 *   aktualisiert dabei den Liveness-Herzschlag `lastSeenAt`.
 * - Pollt der Client länger nicht mehr (Browser zu), gilt der Job als
 *   verlassen → `abandoned`. Der Mistral-Call wird eingespart, der Platz
 *   in der Warteschlange für andere frei.
 *
 * Zeitstempel sind plain Millisekunden-Numbers (`Date.now()`) — direkt
 * vergleichbar, konsistent mit counter.js, kein FieldValue nötig.
 */

const { Timestamp } = require("firebase-admin/firestore");
const { datenbank } = require("./db");
const { LIVENESS_GRACE_MS, JOB_RETENTION_MS, ZUSTELLUNG_AUFBEWAHRUNG_MS } = require("./config");
const { geltendeWerte } = require("./betriebsprofil");

/* ARCH-2026-08-12-27: Frist des Sicherheitsnetzes (Firestore-TTL). Bewusst weit
   ueber JOB_RETENTION_MS (2 h): Der Reaper ist die Loeschung, die TTL faengt nur
   seinen Ausfall ab. Ein knapper Wert wuerde laufende Jobs mitten im Betrieb
   loeschen — genau die Gefahr, die diese Massnahme nicht schaffen darf. */
const TTL_NETZ_MS = 24 * 60 * 60 * 1000;

const JOBS_COLLECTION = "jobs";

/* Ein Job, der länger als das hier in `processing` hängt, gilt als verloren
   (Worker abgestürzt o.ä.) und wird auf `failed` gesetzt, damit kein Client
   ewig pollt.
   BUG-001 (Audit 2026-06): von 600s auf 540s gesenkt = exakt das Cloud-
   Function-Timeout. Ein Job kann nicht länger als 540s legitim in `processing`
   sein (Cloud Run killt den Worker dann). Bei 600s blieb der Job nach einem
   Worker-Kill bis zu 60s länger als „wird verarbeitet" hängen. Das globale
   Pipeline-Budget (REQUEST_BUDGET_MS=480s) liegt darunter, daher werden echte
   Jobs (≈480s + Overhead) NICHT fälschlich gescheitert — und die jetzt
   bedingten Statusübergänge (s. completeJob/failJob) verhindern jede Race. */
const PROCESSING_TIMEOUT_MS = 9 * 60 * 1000;

function jobsRef() {
  return datenbank().collection(JOBS_COLLECTION);
}

/**
 * Legt einen neuen Job an (Status `queued`). Gibt die generierte jobId zurück.
 *
 * @param {object} params
 * @param {string} params.lang       aufgelöste Sprache ("de"/"en")
 * @param {string} [params.traceId]  Trace-ID des Clients (Korrelation), optional
 * @param {string} params.imagePath  Storage-Pfad des zwischengespeicherten Bildes
 * @param {object} [params.exif]     sanitisierte Kamera-Metadaten (make/model),
 *                                   die der Worker an die Profil-Stufe weiterreicht
 */
async function createJob({ lang, traceId, imagePath, exif, resultToken }) {
  const ref = jobsRef().doc();
  const now = Date.now();
  await ref.set({
    status: "queued",
    createdAt: now,
    /* ARCH-2026-08-12-27: Sicherheitsnetz UNTER dem Reaper. Der Reaper räumt
       Job-Dokumente nach JOB_RETENTION_MS (2 h) ab — er ist die eigentliche
       Löschung. Steht er still (pausierter Zeitplan, verlorene Berechtigung),
       gab es bisher nichts darunter: Dokumente mit fertigen Profilen wären
       unbegrenzt liegengeblieben, zugesagt sind "spätestens rund 2 Stunden".
       Firestore löscht Dokumente automatisch, sobald dieses Zeitstempel-Feld
       in der Vergangenheit liegt. Bewusst DEUTLICH später als der Reaper
       (24 h statt 2 h): Das Netz soll fangen, wenn der Reaper ausfällt, und ihm
       nicht ins Handwerk pfuschen, solange er läuft. */
    expiresAt: Timestamp.fromMillis(now + TTL_NETZ_MS),
    lastSeenAt: now,
    startedAt: null,
    finishedAt: null,
    deliveredAt: null,
    lang: lang || "de",
    traceId: traceId || null,
    imagePath: imagePath || null,
    exif: exif && typeof exif === "object" ? exif : {},
    /* PRIV-003 (Audit 2026-06): zweites Schloss auf das Ergebnis. Nur wer dieses
       Ticket hat (der Browser, der den Job angelegt hat), bekommt von job-status
       das `result` zurück — nicht jeder, der die jobId kennt. */
    resultToken: resultToken || null,
    result: null,
    errorReason: null,
    attempts: 0,
  });
  return ref.id;
}

/**
 * Liest einen Job. Gibt `{ id, ...data }` zurück oder `null`, wenn es ihn
 * nicht gibt.
 */
async function getJob(jobId) {
  const snap = await jobsRef().doc(jobId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Idempotenter Claim: versucht den Job von `queued` auf `processing` zu
 * schalten.
 *
 * - Gibt `true` zurück, wenn DIESER Aufruf den Job übernommen hat.
 * - Gibt `false` zurück, wenn der Job nicht (mehr) `queued` ist — z.B. weil
 *   Cloud Tasks den Task wiederholt hat oder zwei Dispatches kollidieren.
 *   In dem Fall darf `process-job` NICHT erneut Mistral aufrufen.
 *
 * Die Firestore-Transaction garantiert: bei parallelen Aufrufen gewinnt
 * genau einer.
 */
async function claimJob(jobId) {
  const db = datenbank();
  const ref = db.collection(JOBS_COLLECTION).doc(jobId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data();
    if (data.status !== "queued") return false;
    tx.update(ref, {
      status: "processing",
      startedAt: Date.now(),
      attempts: (data.attempts || 0) + 1,
    });
    return true;
  });
}

/**
 * Schließt einen Job erfolgreich ab: NUR `processing` → `done` mit Ergebnis.
 *
 * BUG-001 (Audit 2026-06): bedingter Übergang in einer Transaktion. Ein
 * nachlaufender Worker, dessen Job inzwischen vom Reaper auf `failed`/`abandoned`
 * gesetzt wurde, überschreibt diesen Terminalzustand NICHT mehr.
 * @returns {Promise<boolean>} true, wenn dieser Aufruf den Übergang gemacht hat
 */
async function completeJob(jobId, result) {
  const db = datenbank();
  const ref = db.collection(JOBS_COLLECTION).doc(jobId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().status !== "processing") return false;
    tx.update(ref, { status: "done", finishedAt: Date.now(), result: result || null, errorReason: null });
    return true;
  });
}

/**
 * Markiert einen Job als gescheitert: NUR aus `queued`/`processing` → `failed`.
 *
 * BUG-001: bedingt — ein bereits `done`/`abandoned` Job wird NICHT überschrieben.
 * @returns {Promise<boolean>} true, wenn dieser Aufruf den Übergang gemacht hat
 */
async function failJob(jobId, reason) {
  const db = datenbank();
  const ref = db.collection(JOBS_COLLECTION).doc(jobId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const st = snap.data().status;
    if (st !== "queued" && st !== "processing") return false;
    tx.update(ref, {
      status: "failed",
      finishedAt: Date.now(),
      errorReason: typeof reason === "string" ? reason.slice(0, 300) : "unknown",
    });
    return true;
  });
}

/**
 * Warteschlangen-Position: Anzahl der Jobs mit Status `queued`, die VOR
 * diesem Job erstellt wurden. 0 = als nächstes dran.
 *
 * Nimmt das bereits geladene Job-Objekt entgegen (der Aufrufer hat es ohnehin
 * schon) — spart einen zusätzlichen Firestore-Read pro Poll.
 *
 * Nutzt eine Firestore-`count()`-Aggregation — liest nicht alle Dokumente,
 * daher auch bei voller Queue günstig. Benötigt den zusammengesetzten Index
 * (status ASC, createdAt ASC) aus firestore.indexes.json.
 *
 * Für Jobs, die nicht (mehr) `queued` sind, gibt die Funktion 0 zurück.
 */
async function getQueuePosition(job) {
  if (!job || job.status !== "queued") return 0;
  const agg = await jobsRef().where("status", "==", "queued").where("createdAt", "<", job.createdAt).count().get();
  return agg.data().count;
}

/**
 * ARCH-001 (Audit 2026-08-10): Wie viele Jobs warten gerade?
 *
 * Seit v2.8 die Parallelität von 10 auf 7 gesenkt wurde, schafft die
 * Warteschlange rund 387 Analysen pro Stunde — der Einlass lässt aber 500 zu.
 * Bei Dauerlast wächst der Rückstau also, und ab etwa 190 Wartenden
 * überschreitet die Wartezeit den 30-Minuten-Deckel des Browsers: Der
 * Teilnehmer sieht einen Timeout, obwohl sein Job noch lebt.
 *
 * Statt das Stundenlimit zu senken (das würde einem großen Workshop mitten im
 * Betrieb den Hahn zudrehen) lehnt der Einlass ab einer Schwelle ehrlich ab.
 * Zählende Abfrage — günstig, unabhängig von der Warteschlangenlänge.
 */
async function countQueuedJobs() {
  const agg = await jobsRef().where("status", "==", "queued").count().get();
  return agg.data().count;
}

/**
 * Prüft, ob ein `processing`-Job über PROCESSING_TIMEOUT_MS hinaus hängt
 * (Worker tot/abgestürzt). Wenn ja, wird er auf `failed` gesetzt.
 *
 * Gibt den (ggf. aktualisierten) Job-Status zurück. Wird vom job-status-
 * Handler beim Pollen aufgerufen, damit kein Client unendlich wartet.
 */
async function markFailedIfStale(job) {
  if (!job || job.status !== "processing") return job;
  const startedAt = job.startedAt || job.createdAt || 0;
  if (Date.now() - startedAt < PROCESSING_TIMEOUT_MS) return job;
  const failed = await failJob(job.id, "processing_timeout");
  if (failed) return { ...job, status: "failed", errorReason: "processing_timeout" };
  /* BUG-001: failJob hat NICHT gegriffen — der Job ist inzwischen terminal
     (z.B. der Worker hat doch noch `done` geschrieben). Frischen Stand lesen,
     statt fälschlich „failed" zu melden. */
  return (await getJob(job.id)) || job;
}

/* ── Client-Liveness ──────────────────────────────────────────────── */

/**
 * Aktualisiert den Liveness-Herzschlag (`lastSeenAt`) eines Jobs. `job-status`
 * ruft das bei jedem Client-Poll — solange der Browser pollt, gilt der Client
 * als anwesend.
 */
async function touchJob(jobId) {
  await jobsRef().doc(jobId).update({ lastSeenAt: Date.now() });
}

/**
 * Hält den Zeitpunkt der ERSTEN Auslieferung eines fertigen Jobs fest
 * (`deliveredAt`). Diagnose-Messung: trennt „fertig gerechnet" von „tatsächlich
 * beim Client angekommen" — unabhängig von der best-effort Client-Telemetrie.
 * Der job-status-Handler ruft das genau einmal pro Job (Guard dort: nur wenn
 * `deliveredAt` noch nicht gesetzt ist).
 *
 * KA-02 (Kurzaudit 2026-08-12): Mit der Auslieferung wird — im selben
 * Schreibvorgang — der HASH des Realitäts-Check-Einmal-Tickets abgelegt.
 * Das Ticket selbst geht nur an den Browser; die Datenbank kennt nur den
 * Hash und kann daraus kein gültiges Ticket machen.
 */
async function markDelivered(jobId, rcTicketHash) {
  const patch = { deliveredAt: Date.now() };
  if (typeof rcTicketHash === "string" && rcTicketHash.length > 0) {
    patch.rcTicketHash = rcTicketHash;
  }
  await jobsRef().doc(jobId).update(patch);
}

/**
 * KA-02: Entwertet ein Realitäts-Check-Einmal-Ticket (per Hash) und meldet,
 * ob es gültig war. Jede echte Analyse gibt bei der ersten Auslieferung genau
 * EIN Ticket aus — damit zählt jede Analyse höchstens eine Stimme, egal wie
 * viele Function-Instanzen laufen (das frühere In-Memory-IP-Limit vervielfacht
 * sich je Instanz und schützt den öffentlichen Vergleichswert nicht).
 *
 * Ablauf: Job per Hash-Gleichheit suchen (automatischer Einzelfeld-Index,
 * kein zusammengesetzter nötig), dann in einer TRANSAKTION erneut lesen und
 * den Hash auf null setzen. Zwei gleichzeitige Einreichungen desselben
 * Tickets können so nie beide zählen: Die zweite Transaktion sieht den Hash
 * nicht mehr. Läuft die 15-Minuten-Löschfrist (PRIV-107b) vorher ab, ist das
 * Dokument weg und das Ticket damit von selbst wertlos.
 */
async function verbraucheRcTicket(rcTicketHash) {
  if (typeof rcTicketHash !== "string" || rcTicketHash.length === 0) return false;
  const snap = await jobsRef().where("rcTicketHash", "==", rcTicketHash).limit(1).get();
  if (snap.empty) return false;
  const ref = snap.docs[0].ref;
  const db = datenbank();
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists || doc.data().rcTicketHash !== rcTicketHash) return false;
    /* null statt FieldValue.delete(): Zeitstempel/Werte sind in dieser Datei
       bewusst plain (s. Datei-Kopf), und die Gleichheits-Suche oben findet
       ein null-Feld nie wieder — entwertet ist entwertet. */
    tx.update(ref, { rcTicketHash: null });
    return true;
  });
}

/**
 * v3.0 Phase 1 (+Phase 3): Legt die bereits angekommenen Live-Profiltexte
 * ins Job-Dokument.
 *
 * Der Worker ruft das waehrend eines laufenden Mistral-Streams (Flag
 * `useLiveText`) mit `{ standard, beast }`, der job-status-Handler gibt die
 * Felder bei `processing` an den Client weiter. Die Feldnamen bleiben
 * abwaertskompatibel: `liveText` traegt weiter den Standard-Text, der
 * Beast-Text kommt ZUSAETZLICH als `liveTextBeast` dazu; `liveTextStand`
 * gilt gemeinsam fuer beide. Solange Beast noch nicht begonnen hat
 * (`beast === null`), bleibt das Feld dem Dokument bewusst fern — der
 * Client zeigt dann seinen Warte-Status.
 *
 * 4000 Zeichen Deckel JE FELD: Ein kompletter Profiltext liegt real bei
 * wenigen hundert Zeichen — die Grenze schuetzt das Dokument nur vor einem
 * amoklaufenden Modell (Firestore-Dokumente sind auf 1 MiB begrenzt, und
 * `result` muss spaeter auch noch hinein).
 *
 * Fehler werden STILL geschluckt: Eine verpasste Live-Welle darf nie etwas
 * kaputt machen — der naechste Schreibversuch kommt ohnehin in ~2 Sekunden,
 * und das eigentliche Ergebnis liefert completeJob unabhaengig davon. Auch
 * kein console.log je Welle: Bei ~1100 Chunks pro Analyse waere selbst ein
 * sparsames Fehler-Log nur Rauschen in Cloud Logging.
 */
async function setLiveText(jobId, texte) {
  try {
    /* Abwaertskompatibel: ein nackter String (alter Aufrufstil) zaehlt als
       Standard-Text ohne Beast. */
    const eingabe = typeof texte === "string" ? { standard: texte } : texte || {};
    const patch = {
      liveText: String(eingabe.standard || "").slice(0, 4000),
      liveTextStand: Date.now(),
    };
    if (typeof eingabe.beast === "string") {
      patch.liveTextBeast = eingabe.beast.slice(0, 4000);
    }
    /* FEATURE-2026-08-29-01: Fertige Kategorie-Karten mitschreiben, damit der
       Bildschirm nicht stillsteht, waehrend sie entstehen. Beide Grenzen sind
       Absicherung gegen ein aufgeblaehtes Job-Dokument, nicht Sparsamkeit:
       13 Karten sind das Maximum laut Schema, 400 Zeichen decken die im Prompt
       verlangten 20-30 Woerter mit Reserve. */
    for (const [feld, quelle] of [
      ["liveKartenStandard", eingabe.kartenStandard],
      ["liveKartenBeast", eingabe.kartenBeast],
    ]) {
      if (!Array.isArray(quelle)) continue;
      patch[feld] = quelle.slice(0, 13).map((k) => ({
        schluessel: String(k.schluessel || "").slice(0, 40),
        bezeichnung: String(k.bezeichnung || "").slice(0, 80),
        wert: String(k.wert || "").slice(0, 400),
      }));
    }
    await jobsRef().doc(jobId).update(patch);
  } catch (_) {
    /* still — siehe Funktionskommentar */
  }
}

/**
 * Markiert einen Job als `abandoned` — der Client hat die Seite verlassen,
 * bevor der Job verarbeitet wurde. Kein Fehler, sondern ein bewusst
 * eingesparter Lauf (kein Mistral-Call).
 */
async function abandonJob(jobId) {
  const db = datenbank();
  const ref = db.collection(JOBS_COLLECTION).doc(jobId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    /* BUG-001: nur einen noch `queued` Job verlassen — ein inzwischen in
       Verarbeitung gegangener (oder fertiger) Job wird NICHT abgewürgt. */
    if (!snap.exists || snap.data().status !== "queued") return false;
    tx.update(ref, { status: "abandoned", finishedAt: Date.now() });
    return true;
  });
}

/**
 * Prüft, ob ein noch wartender Job als verlassen gilt: Status `queued` und
 * seit über LIVENESS_GRACE_MS kein Client-Poll mehr.
 */
/* Die Gnadenfrist kommt seit 30.08.2026 aus dem Einstellungssatz und wird
   hereingereicht — diese Funktion bleibt synchron, weil sie in Schleifen ueber
   viele Jobs laeuft. Fehlt der Wert, gilt die Konstante: Eine Aufraeum-Frist
   darf nie fehlen, sonst blieben verwaiste Jobs ewig liegen. */
function isAbandoned(job, gnadenfristMs) {
  const frist = typeof gnadenfristMs === "number" && gnadenfristMs > 0 ? gnadenfristMs : LIVENESS_GRACE_MS;
  if (!job || job.status !== "queued") return false;
  return Date.now() - (job.lastSeenAt || job.createdAt || 0) > frist;
}

/**
 * Zählt die Jobs im Status `processing`. Prozess-übergreifende Wahrheit für
 * die Drosselung des lokalen Cloud-Tasks-Ersatzes (siehe handle-process-job).
 */
async function countProcessingJobs() {
  const agg = await jobsRef().where("status", "==", "processing").count().get();
  return agg.data().count;
}

/**
 * Liefert wartende Jobs, deren Client-Herzschlag älter als das Karenz-Fenster
 * ist — die Arbeitsliste des Reapers. `limit` deckelt die Batch-Größe pro
 * Lauf. Benötigt den zusammengesetzten Index (status, lastSeenAt).
 */
async function findAbandonedJobs(limit = 200) {
  const { werte: lw } = await geltendeWerte().catch(() => ({ werte: null }));
  const gnadenfrist = lw && lw.livenessGnadenfristMs ? lw.livenessGnadenfristMs : LIVENESS_GRACE_MS;
  const cutoff = Date.now() - gnadenfrist;
  const snap = await jobsRef().where("status", "==", "queued").where("lastSeenAt", "<", cutoff).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* SEC-003 (Audit 2026-08-10): Obergrenze, wie lange ein Job allein durch
   Pollen am Leben gehalten werden kann.

   Jeder Poll erneuert `lastSeenAt` — wer also einfach weiterfragt, haelt seinen
   Job unbegrenzt in der Warteschlange und blockiert damit einen Platz im
   Stundenfenster. Das ist der billigste Hebel, den Dienst fuer eine Schulklasse
   unbrauchbar zu machen: 500 Mini-Uploads anlegen, danach im Takt pollen, und
   der Reaper gibt nie einen Platz zurueck.

   Eine ehrliche Wartezeit liegt bei wenigen Minuten; der Browser gibt nach
   30 Minuten ohnehin auf. Alles darueber ist kein wartender Nutzer mehr. */
const MAX_QUEUED_AGE_MS = 35 * 60 * 1000;

async function findUeberfaelligeJobs(limit = 200) {
  const cutoff = Date.now() - MAX_QUEUED_AGE_MS;
  const snap = await jobsRef().where("status", "==", "queued").where("createdAt", "<", cutoff).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Liefert Jobs, die über PROCESSING_TIMEOUT_MS hinaus in `processing` hängen
 * (Worker abgestürzt, niemand pollt mehr → `markFailedIfStale` greift nie).
 * Arbeitsliste des Reapers, damit solche Dokumente nicht ewig liegen bleiben.
 * Benötigt den zusammengesetzten Index (status, startedAt).
 */
async function findStaleProcessingJobs(limit = 200) {
  const cutoff = Date.now() - PROCESSING_TIMEOUT_MS;
  const snap = await jobsRef().where("status", "==", "processing").where("startedAt", "<", cutoff).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Liefert Job-Dokumente, die älter als JOB_RETENTION_MS sind — egal welchen
 * Status. Arbeitsliste des Reapers für die Datensparsamkeits-Aufräumung; ein
 * derart altes Dokument ist in jedem Status fertig (ein realer Job lebt
 * Sekunden bis Minuten). Einfache Ungleichheit auf `createdAt`, daher vom
 * automatischen Einzelfeld-Index abgedeckt — kein zusammengesetzter Index.
 */
async function findExpiredJobs(limit = 200) {
  const { werte } = await geltendeWerte().catch(() => ({ werte: null }));
  const aufbewahrung = werte && werte.jobAufbewahrungMs ? werte.jobAufbewahrungMs : JOB_RETENTION_MS;
  const cutoff = Date.now() - aufbewahrung;
  const snap = await jobsRef().where("createdAt", "<", cutoff).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * PRIV-107b: Liefert zugestellte Jobs, deren Browser-Wiederholungs-Fenster
 * abgelaufen ist (`deliveredAt` älter als ZUSTELLUNG_AUFBEWAHRUNG_MS). Das
 * Dokument hat ab da keinen Zweck mehr — der Browser zeigt das Ergebnis
 * ohnehin nicht mehr an. Die Ungleichheits-Abfrage überspringt Dokumente
 * ohne `deliveredAt` (nie zugestellt) von selbst.
 */
async function findZugestellteJobs(limit = 200) {
  const { werte: zw } = await geltendeWerte().catch(() => ({ werte: null }));
  const zustellfenster = zw && zw.zustellfensterMs ? zw.zustellfensterMs : ZUSTELLUNG_AUFBEWAHRUNG_MS;
  const cutoff = Date.now() - zustellfenster;
  const snap = await jobsRef().where("deliveredAt", "<", cutoff).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Löscht ein Job-Dokument endgültig.
 */
async function deleteJob(jobId) {
  await jobsRef().doc(jobId).delete();
}

module.exports = {
  JOBS_COLLECTION,
  PROCESSING_TIMEOUT_MS,
  createJob,
  getJob,
  claimJob,
  completeJob,
  failJob,
  getQueuePosition,
  countQueuedJobs,
  markFailedIfStale,
  touchJob,
  markDelivered,
  verbraucheRcTicket,
  setLiveText,
  abandonJob,
  isAbandoned,
  findAbandonedJobs,
  findUeberfaelligeJobs,
  MAX_QUEUED_AGE_MS,
  findStaleProcessingJobs,
  findExpiredJobs,
  findZugestellteJobs,
  deleteJob,
  countProcessingJobs,
};
