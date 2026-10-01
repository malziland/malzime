/**
 * verbindungsfehler.js — Erkennt einen Verbindungsabriss beim Aufruf eines
 * fremden Dienstes und macht seinen Grund protokollierbar, OHNE Adressen.
 *
 * ANLASS (Workshop 01.10.2026, 11:01 und 11:03): Zwei Analysen scheiterten mit
 * `terminated`. So meldet Node.js (undici) einen Strom, der mitten in der
 * Antwort abreisst; mit `fetch failed` einen Abbruch, bevor die Antwort
 * begann. Den eigentlichen Grund ("other side closed", "Zeitlimit", ...)
 * liefert Node.js nur in `err.cause` — protokolliert wurde bisher allein
 * `err.message`, und damit war nicht feststellbar, wer abgebrochen hatte.
 *
 * DATENSCHUTZ (Vorgabe, nicht Funktion): Das technische Protokoll traegt laut
 * Datenschutzerklaerung Schritt, Erfolg, Dauer, Textmenge und die
 * Zufallsnummer — "keine IP-Adresse". An `err.cause` haengen bei Node.js die
 * Verbindungsdaten beider Seiten (Adressen, Ports, Bytezahlen). Herausgegeben
 * werden deshalb NUR zwei Angaben: der Fehlercode (feste Grossbuchstaben-Kennung
 * wie `UND_ERR_SOCKET`) und der Kurztext des Grundes, in dem jede Adresse
 * unkenntlich gemacht ist. Beides beschreibt, OB und WARUM der Schritt
 * scheiterte — nichts ueber den Menschen, der das Foto hochgeladen hat.
 */

/* Fehlercodes von Node.js/undici, die einen Abriss oder Ausfall der
   Verbindung bedeuten — nicht eine Antwort des Dienstes. */
const VERBINDUNGS_CODES = new Set([
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

/** Ist das ein Abriss der Verbindung (und nicht unser Zeitlimit, nicht eine
 *  Antwort des Dienstes)? */
function istVerbindungsabbruch(err) {
  if (!err || err.name === "AbortError") return false;
  if (err instanceof TypeError && (err.message === "terminated" || err.message === "fetch failed")) return true;
  const code = err.cause && err.cause.code;
  return typeof code === "string" && VERBINDUNGS_CODES.has(code);
}

/* Adressen in jeder Schreibweise: IPv4 (auch mit Port), IPv6 (auch in
   eckigen Klammern) und Rechnername:Port. */
const ADRESSE = [
  /\[?(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\]?(?::\d+)?/gi,
  /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g,
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+:\d+\b/gi,
];

/**
 * Grund eines Fehlers als { code, text } — oder null, wenn es keinen gibt.
 * Nur Code und Kurztext; Adressen werden zu "[Adresse]".
 */
function ursacheVon(err) {
  const grund = err && err.cause;
  if (!grund || typeof grund !== "object") return null;
  const code = typeof grund.code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(grund.code) ? grund.code : null;
  let text = typeof grund.message === "string" ? grund.message : "";
  for (const muster of ADRESSE) text = text.replace(muster, "[Adresse]");
  text = text.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!code && !text) return null;
  return { code, text };
}

/**
 * Markiert einen Abriss fuer mistral.js (Rettung des Teiltexts, sonst ein
 * Neuversuch) und gibt den Fehler zurueck — `throw markiereAbbruch(err, text)`.
 * Alles andere bleibt unveraendert.
 */
function markiereAbbruch(err, teiltext) {
  if (istVerbindungsabbruch(err)) {
    err.verbindungsabbruch = true;
    err.teiltext = teiltext || "";
  }
  return err;
}

/**
 * Warnung (kein Alarm) fuer den ersten Abriss eines Analyse-Aufrufs: Es folgt
 * ein Neuversuch; erst wenn der scheitert, schreibt mistral.js den Fehler mit
 * Alarm. Felder wie die Fehlerzeile, der Grund nur ueber ursacheVon.
 */
function meldeAbbruchMitNeuversuch({ profil, attempt, err }) {
  console.warn(
    JSON.stringify({
      severity: "WARNING",
      step: "mistral-single-large-details",
      profil: profil || null,
      attempt,
      status: "abbruch-neuversuch",
      error: err.message,
      ursache: ursacheVon(err),
    })
  );
}

/**
 * Fuehrt `erster()` aus; scheitert er an einem markierten Abriss (und NUR
 * dann), einmal `neuversuch()`. Alles andere wird unveraendert geworfen.
 */
async function mitEinemNeuversuchBeiAbbruch(erster, neuversuch) {
  try {
    return await erster();
  } catch (err) {
    if (!(err && err.verbindungsabbruch)) throw err;
    return neuversuch();
  }
}

/** Liegt ein gelesener Teiltext vor, der gerettet werden kann (Zeitlimit
 *  oder Abriss mitten im Strom)? */
function hatRettbarenTeiltext(err) {
  return Boolean(
    err &&
    (err.code === "timeout" || err.verbindungsabbruch) &&
    typeof err.teiltext === "string" &&
    err.teiltext.length > 0
  );
}

module.exports = {
  istVerbindungsabbruch,
  ursacheVon,
  markiereAbbruch,
  meldeAbbruchMitNeuversuch,
  mitEinemNeuversuchBeiAbbruch,
  hatRettbarenTeiltext,
};
