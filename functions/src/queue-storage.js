"use strict";

/**
 * queue-storage.js — temporäre Bild-Ablage für die Queue-Architektur (v2.0).
 *
 * Im Queue-Modus nimmt `enqueue` das Bild an und legt es kurz im dedizierten
 * Cloud-Storage-Bucket `QUEUE_BUCKET` (Prefix `queue-uploads/`) ab.
 * `processJob` lädt es, verarbeitet es und löscht es unmittelbar danach
 * wieder (Erfolg ODER Fehler). Eine GCS-Lifecycle-Regel löscht alles unter
 * dem Prefix nach 1 Tag — das zweite Sicherheitsnetz, falls die aktive
 * Löschung mal ausfällt (etwa bei einem Worker-Absturz).
 *
 * Der Bucket ist ein eigener, NICHT öffentlicher Bucket: Zugriff nur
 * serverseitig über das Admin-SDK, kein Browser-Zugriff. Kein Firebase-
 * Storage-Default-Bucket — Client-SDK-Features brauchen wir nicht.
 *
 * DSGVO: Das Bild enthält kein GPS (wird client-seitig entfernt — unverändert
 * zur bisherigen Architektur). Die Ablage ist kurzlebig und auf europe-west1
 * begrenzt.
 *
 * Der Storage-Bucket wird lazy aufgelöst und ist über `setBucketForTest()`
 * für Unit-Tests ersetzbar.
 */

const crypto = require("crypto");
const { getStorage } = require("firebase-admin/storage");
const { QUEUE_BUCKET, QUEUE_UPLOAD_PREFIX } = require("./config");

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

let bucketOverride = null;

function bucket() {
  return bucketOverride || getStorage().bucket(QUEUE_BUCKET);
}

/**
 * Legt ein Bild unter `queue-uploads/<uuid>.<ext>` ab.
 * @returns {Promise<string>} der Storage-Pfad (in das Job-Dokument zu schreiben)
 */
async function storeImage(buffer, mimeType) {
  const ext = EXT_BY_MIME[mimeType] || "jpg";
  const path = `${QUEUE_UPLOAD_PREFIX}${crypto.randomUUID()}.${ext}`;
  await bucket()
    .file(path)
    .save(buffer, {
      contentType: mimeType || "image/jpeg",
      resumable: false,
    });
  return path;
}

/**
 * Lädt ein zuvor abgelegtes Bild.
 * @returns {Promise<{buffer: Buffer, mimeType: string}>}
 */
async function loadImage(path) {
  const file = bucket().file(path);
  const [buffer] = await file.download();
  const [metadata] = await file.getMetadata();
  return { buffer, mimeType: (metadata && metadata.contentType) || "image/jpeg" };
}

/**
 * Löscht ein Bild. Ein bereits gelöschtes / nie existentes Objekt ist KEIN
 * harter Fehler — die Lifecycle-Regel räumt ohnehin nach. Der Aufrufer
 * (processJob) soll deshalb nie an einer fehlgeschlagenen Löschung scheitern.
 */
async function deleteImage(path) {
  if (!path) return;
  try {
    await bucket().file(path).delete();
  } catch (err) {
    console.log(JSON.stringify({ warning: "queue-image-delete-failed", path, error: err.message }));
  }
}

/* Nur für Tests — ersetzt den Storage-Bucket durch eine Attrappe. */
function setBucketForTest(impl) {
  bucketOverride = impl;
}

module.exports = {
  storeImage,
  loadImage,
  deleteImage,
  setBucketForTest,
};
