const crypto = require("crypto");

/* Die Gueltigkeitsdauer kommt aus dem Einstellungssatz (ticketGueltigkeitMs)
   und wird vom Aufrufer uebergeben. Kein Rueckfallwert: Ein Token, das
   laenger gilt als gedacht, ist ein Sicherheitsproblem — und welche Dauer
   gaelte, haenge sonst davon ab, welcher Aufrufweg genommen wurde. */

/**
 * Erstellt einen HMAC-signierten Admin-Token.
 * Format: {expires}.{signature}
 * Der Token ist an eine bestimmte Action gebunden (z.B. "boost", "reset").
 */
/* AUDIT-BEFUND SEC-2026-08-12-17: Token und Nonce trugen dieselbe Nutzlast
   (`${action}.${expires}`) und waren damit kryptografisch nicht unterscheidbar.
   Ein 30-Minuten-Token aus der ntfy-Push-URL liess sich deshalb im Nonce-Feld
   einsetzen und die Bestaetigungsseite (SEC-001) ueberspringen. Die Nutzlast
   traegt jetzt den Verwendungszweck; ein Token fuer den einen Zweck ist fuer den
   anderen ungueltig. */
const ZWECK_TOKEN = "token";
const ZWECK_NONCE = "nonce";

function signiere(zweck, action, expires, secret) {
  return crypto.createHmac("sha256", secret).update(`${zweck}.${action}.${expires}`).digest("hex");
}

function createAdminToken(action, secret, ttlMs, zweck = ZWECK_TOKEN) {
  if (typeof ttlMs !== "number" || !(ttlMs > 0)) {
    throw new Error("createAdminToken: ticketGueltigkeitMs fehlt");
  }
  const expires = Date.now() + ttlMs;
  return `${expires}.${signiere(zweck, action, expires, secret)}`;
}

/**
 * Validiert einen HMAC-signierten Admin-Token.
 * Prueft: Format, Ablaufzeit, Action-Bindung, Signatur (timing-safe).
 */
function verifyAdminToken(token, action, secret, zweck = ZWECK_TOKEN) {
  if (!token || typeof token !== "string") return false;

  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return false;

  const expiresStr = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);

  const expires = Number(expiresStr);
  if (isNaN(expires) || Date.now() >= expires) return false;

  const expected = signiere(zweck, action, expiresStr, secret);

  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 Minuten

/**
 * Erstellt eine kurzlebige Nonce fuer Admin-Bestaetigungsseiten (SEC-001).
 * Format: {expires}.{signature} — wie ein Token, aber mit 5 Min TTL.
 */
function createNonce(action, secret) {
  return createAdminToken(action, secret, NONCE_TTL_MS, ZWECK_NONCE);
}

/**
 * Validiert eine Nonce. Wrapper um verifyAdminToken.
 */
function verifyNonce(nonce, action, secret) {
  return verifyAdminToken(nonce, action, secret, ZWECK_NONCE);
}

/**
 * SEC-002: Nonce-Replay-Schutz via Firestore.
 * Speichert benutzte Nonces mit Timestamp. Gibt false zurueck wenn die Nonce
 * bereits verbraucht wurde. Fail-closed bei Firestore-Fehlern (seit v3.0.4):
 * Laesst sich der Verbrauch nicht festhalten, gilt die Nonce als nicht
 * einloesbar — Admin-Komfort ist verzichtbar, ein Replay-Fenster nicht.
 * Der Bearer-Pfad (direktes Admin-Secret) haengt nicht an Nonces, und die
 * Admin-Mutationen selbst schreiben ohnehin in Firestore — bei einem echten
 * Firestore-Ausfall geht durch fail-closed also nichts verloren.
 */
async function consumeNonce(nonce) {
  const { datenbank } = require("./db");
  const hash = crypto.createHash("sha256").update(nonce).digest("hex").slice(0, 16);
  const ref = datenbank().collection("usedNonces").doc(hash);
  try {
    await ref.create({ usedAt: Date.now() });
    return true;
  } catch (err) {
    if (err.code === 6) return false; // ALREADY_EXISTS
    console.log(JSON.stringify({ warning: "nonce-store-error", error: err.message }));
    return false; // fail-closed
  }
}

/**
 * Loescht abgelaufene Nonces (aelter als NONCE_TTL_MS).
 * Fire-and-forget, max 50 pro Aufruf.
 */
async function cleanupNonces() {
  const { datenbank } = require("./db");
  const cutoff = Date.now() - NONCE_TTL_MS;
  const snapshot = await datenbank().collection("usedNonces").where("usedAt", "<", cutoff).limit(50).get();
  if (snapshot.empty) return;
  const batch = datenbank().batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

/**
 * SHA-256 als Hex-String. Gebraucht fuer das Einmal-Ticket des
 * Realitaets-Checks (KA-02): Im Job-Dokument liegt NUR der Hash, nie das
 * Ticket selbst — wer die Datenbank liest, kann daraus kein gueltiges
 * Ticket rekonstruieren (dieselbe Philosophie wie beim resultToken-Vergleich).
 */
function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

/**
 * SEC-01: Konstantzeitiger String-Vergleich fuer Secrets/Tokens.
 * Verhindert Timing-Seitenkanaele, ueber die ein Angreifer ein Secret
 * byteweise rekonstruieren koennte. Ein Laengen-Mismatch wird frueh und
 * ohne Vergleich abgefangen — die Laenge ist ohnehin kein Geheimnis.
 */
function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  createAdminToken,
  verifyAdminToken,
  createNonce,
  verifyNonce,
  consumeNonce,
  cleanupNonces,
  safeCompare,
  sha256Hex,
  NONCE_TTL_MS,
};
