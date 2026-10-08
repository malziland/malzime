/* ── Abmelden eines Auftrags, den der Tab nicht mehr abholt ──────────────
   Seit 08.10.2026 ein eigenes Modul (vorher Teil von api.js). Hier steht, WIE
   abgemeldet wird und was als „offen" gilt; WANN abgemeldet wird, entscheidet
   der Ablauf in api.js. */
import { JOB_STATUS_URL } from "./auftrag-abfrage.js";
import { getStoredJobId, offenerAuftrag } from "./auftrag-speicher.js";

/* PRIV-2026-10-03-57: Meldet dem Server einen Auftrag ab, den dieser Tab
   nicht mehr abholt. Wartet der Auftrag noch, verwirft ihn der Server sofort:
   kein KI-Aufruf, der Platz im Stundenkontingent wird frei, das Bild
   geloescht. Laeuft er schon, aendert die Abmeldung nichts. Ohne Abhol-Ticket
   nimmt der Server sie nicht an. Bestmoeglich und still: Scheitert sie, raeumt
   der Server den Auftrag wie bisher nach seiner Karenz selbst ab. Je Auftrag
   geht hoechstens eine Abmeldung hinaus. */
const abgemeldet = new Set();
export function meldeAuftragAb(jobId, resultToken) {
  if (!jobId || !resultToken || abgemeldet.has(jobId)) return;
  abgemeldet.add(jobId);
  try {
    fetch(`${JOB_STATUS_URL}?jobId=${encodeURIComponent(jobId)}&token=${encodeURIComponent(resultToken)}`, {
      method: "DELETE",
      cache: "no-store",
      keepalive: true,
    }).catch(() => {});
  } catch (_) {
    /* Abmelden ist ein Zusatz — nie ein Grund fuer eine Fehlermeldung. */
  }
}

/* ── Welchen Auftrag holt der Tab gerade ab? ─────────────────────────────
   Die Seite fuehrt darueber Buch, statt es aus dem Tab-Speicher zu erraten.
   Der Speicher taugt dafuer nicht: Nach langer Pause im Hintergrund wird die
   Nummer dort vergessen (das Geraet gilt als weitergereicht), der Durchgang
   fragt aber mit seiner eigenen Nummer weiter. Wer aus „Nummer fehlt" auf
   „anderes Foto" schloss, meldete einen Auftrag ab, den die Seite noch
   abholte — das Kind verlor seinen Platz in der Schlange (Pruefungen vom
   08.10.2026).

   Ein Auftrag ist „in Arbeit", solange ein Durchgang ihn abfragt oder die
   Seite nach einem Verbindungsabriss auf ihn wartet. Am Ziel (Ergebnis,
   gescheitert, verworfen) ist er es nicht mehr. Abgemeldet wird genau dann,
   wenn die Seite einen Auftrag in Arbeit FALLEN LAESST: ein anderes Foto
   beginnt, oder sie gibt das Warten auf. */
let inArbeit = null;

/** Fuehrt die Abfrage eines Auftrags aus und haelt solange fest, dass der Tab
 *  ihn abholt. Uebernimmt ein Nachfolger (Wiederaufnahme desselben Auftrags
 *  oder ein anderes Foto), gehoert die Notiz ihm — dieser Durchgang ruehrt sie
 *  dann nicht mehr an.
 *
 *  Reisst die Verbindung ab, bleibt der Auftrag in Arbeit: Die Seite holt ihn
 *  spaeter ab. Das kann sie aber nur, wenn seine Nummer noch im Tab steht.
 *
 *  Zwei Ausgaenge, an denen die SEITE einen Auftrag aufgibt, der am Server
 *  noch warten kann — beide Male wird er abgemeldet:
 *  - Verbindungsabriss, und die Nummer ist nach langer Pause vergessen: Der
 *    Durchgang bekommt „verworfen" zurueck (mit `aufgegeben`), und die Meldung
 *    bittet ums erneute Hochladen, statt ein Ergebnis zuzusagen, das niemand
 *    mehr abholen kann.
 *  - Die Hoechstdauer des Wartens ist erreicht (`error.timeout`). */
export async function alsAuftragDesTabs(jobId, resultToken, abfrage) {
  const marke = { jobId, resultToken };
  inArbeit = marke;
  const ausgang = await abfrage();
  if (inArbeit !== marke) return ausgang;
  const abriss = Boolean(ausgang && ausgang.transient);
  if (abriss && getStoredJobId() === jobId) return ausgang;
  inArbeit = null;
  if (abriss) {
    meldeAuftragAb(jobId, resultToken);
    return { abandoned: true, aufgegeben: true };
  }
  if (ausgang && ausgang.error === "error.timeout") {
    meldeAuftragAb(jobId, resultToken);
    return { ...ausgang, aufgegeben: true };
  }
  return ausgang;
}

/* Die Seite laesst fallen, was sie in Arbeit hat — oder, nach einem Neuladen
   ohne Wiederaufnahme, was der Tab gemerkt und noch nicht bekommen hat. Ein
   Auftrag, dessen Ergebnis schon auf dem Bildschirm stand, braucht das nicht. */
export function meldeOffenenAuftragAb() {
  const offen = inArbeit || offenerAuftrag();
  inArbeit = null;
  if (offen) meldeAuftragAb(offen.jobId, offen.resultToken);
}
