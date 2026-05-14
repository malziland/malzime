const crypto = require("crypto");

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 Minuten

/**
 * Erstellt einen HMAC-signierten Admin-Token.
 * Format: {expires}.{signature}
 * Der Token ist an eine bestimmte Action gebunden (z.B. "boost", "reset").
 */
function createAdminToken(action, secret, ttlMs = DEFAULT_TTL_MS) {
  const expires = Date.now() + ttlMs;
  const payload = `${action}.${expires}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${expires}.${signature}`;
}

/**
 * Validiert einen HMAC-signierten Admin-Token.
 * Prueft: Format, Ablaufzeit, Action-Bindung, Signatur (timing-safe).
 */
function verifyAdminToken(token, action, secret) {
  if (!token || typeof token !== "string") return false;

  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return false;

  const expiresStr = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);

  const expires = Number(expiresStr);
  if (isNaN(expires) || Date.now() >= expires) return false;

  const payload = `${action}.${expiresStr}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 Minuten

/**
 * Erstellt eine kurzlebige Nonce fuer Admin-Bestaetigungsseiten (SEC-001).
 * Format: {expires}.{signature} — wie ein Token, aber mit 5 Min TTL.
 */
function createNonce(action, secret) {
  return createAdminToken(action, secret, NONCE_TTL_MS);
}

/**
 * Validiert eine Nonce. Wrapper um verifyAdminToken.
 */
function verifyNonce(nonce, action, secret) {
  return verifyAdminToken(nonce, action, secret);
}

/**
 * SEC-002: Nonce-Replay-Schutz via Firestore.
 * Speichert benutzte Nonces mit Timestamp. Gibt false zurueck wenn die Nonce
 * bereits verbraucht wurde. Fail-open bei Firestore-Fehlern.
 */
async function consumeNonce(nonce) {
  const { getFirestore } = require("firebase-admin/firestore");
  const hash = crypto.createHash("sha256").update(nonce).digest("hex").slice(0, 16);
  const ref = getFirestore().collection("usedNonces").doc(hash);
  try {
    await ref.create({ usedAt: Date.now() });
    return true;
  } catch (err) {
    if (err.code === 6) return false; // ALREADY_EXISTS
    console.log(JSON.stringify({ warning: "nonce-store-error", error: err.message }));
    return true; // fail-open
  }
}

/**
 * Loescht abgelaufene Nonces (aelter als NONCE_TTL_MS).
 * Fire-and-forget, max 50 pro Aufruf.
 */
async function cleanupNonces() {
  const { getFirestore } = require("firebase-admin/firestore");
  const cutoff = Date.now() - NONCE_TTL_MS;
  const snapshot = await getFirestore().collection("usedNonces").where("usedAt", "<", cutoff).limit(50).get();
  if (snapshot.empty) return;
  const batch = getFirestore().batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
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
  DEFAULT_TTL_MS,
  NONCE_TTL_MS,
};
