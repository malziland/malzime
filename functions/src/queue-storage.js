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
 * Lokal-Modus (QUEUE_LOCAL=1, Emulator): Statt des GCS-Buckets wird ein
 * Temp-Verzeichnis auf der Festplatte genutzt — der Storage-Pfad bleibt
 * formgleich (`queue-uploads/<uuid>.<ext>`), sodass der übrige Code keinen
 * Unterschied sieht.
 *
 * DSGVO: Das Bild enthält kein GPS (wird client-seitig entfernt — unverändert
 * zur bisherigen Architektur). Die Ablage ist kurzlebig und auf europe-west1
 * begrenzt.
 *
 * Der Storage-Bucket wird lazy aufgelöst und ist über `setBucketForTest()`
 * für Unit-Tests ersetzbar.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { getStorage } = require("firebase-admin/storage");
const { QUEUE_BUCKET, QUEUE_UPLOAD_PREFIX, isLocalQueueMode } = require("./config");

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MIME_BY_EXT = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

let bucketOverride = null;

function bucket() {
  return bucketOverride || getStorage().bucket(QUEUE_BUCKET);
}

/* Temp-Verzeichnis der Lokal-Modus-Ablage. */
function localDir() {
  return path.join(os.tmpdir(), "malzime-queue-uploads");
}

/* Mappt einen Storage-Pfad (`queue-uploads/<name>`) auf die lokale Datei. */
function localPathFor(objectPath) {
  return path.join(localDir(), path.basename(objectPath));
}

/**
 * Legt ein Bild unter `queue-uploads/<uuid>.<ext>` ab.
 * @returns {Promise<string>} der Storage-Pfad (in das Job-Dokument zu schreiben)
 */
async function storeImage(buffer, mimeType) {
  const ext = EXT_BY_MIME[mimeType] || "jpg";
  const objectPath = `${QUEUE_UPLOAD_PREFIX}${crypto.randomUUID()}.${ext}`;

  if (isLocalQueueMode()) {
    await fs.promises.mkdir(localDir(), { recursive: true });
    await fs.promises.writeFile(localPathFor(objectPath), buffer);
    return objectPath;
  }

  await bucket()
    .file(objectPath)
    .save(buffer, {
      contentType: mimeType || "image/jpeg",
      resumable: false,
    });
  return objectPath;
}

/**
 * Lädt ein zuvor abgelegtes Bild.
 * @returns {Promise<{buffer: Buffer, mimeType: string}>}
 */
async function loadImage(objectPath) {
  if (isLocalQueueMode()) {
    const buffer = await fs.promises.readFile(localPathFor(objectPath));
    const ext = path.extname(objectPath).slice(1).toLowerCase();
    return { buffer, mimeType: MIME_BY_EXT[ext] || "image/jpeg" };
  }

  const file = bucket().file(objectPath);
  const [buffer] = await file.download();
  const [metadata] = await file.getMetadata();
  return { buffer, mimeType: (metadata && metadata.contentType) || "image/jpeg" };
}

/**
 * Löscht ein Bild und meldet, OB es geklappt hat.
 *
 * Rückgabe: true = gelöscht oder war schon weg, false = Löschung gescheitert.
 *
 * AUDIT-BEFUND PRIV-2026-08-12-26 / OPS-2026-08-12-10: Bisher verschluckte diese
 * Funktion jeden Fehler in eine `console.log`-Zeile ohne severity — also unterhalb
 * der Alarmschwelle — und gab nichts zurück. Der Aufrufer löschte danach das
 * Job-Dokument, und mit ihm den einzigen Verweis auf die Datei: Nach einem
 * Fehlschlag kannte niemand mehr den Pfad. Gemessen: 11 solcher Fehlschläge in
 * 30 Tagen. Die Zusage lautet "unmittelbar gelöscht"; das 1-Tages-Netz der
 * Lifecycle-Regel steht in keinem Außentext.
 *
 * Ein bereits gelöschtes Objekt (404) bleibt KEIN Fehler — das ist der Normalfall,
 * wenn der Worker schon aufgeräumt hat. Alles andere ist einer und wird laut.
 */
async function deleteImage(objectPath) {
  if (!objectPath) return true;
  try {
    if (isLocalQueueMode()) {
      await fs.promises.unlink(localPathFor(objectPath));
      return true;
    }
    await bucket().file(objectPath).delete();
    return true;
  } catch (err) {
    /* 404 = schon weg. Kein Fehler, keine Meldung. */
    if (err && (err.code === 404 || err.code === "ENOENT")) return true;
    console.error(
      JSON.stringify({
        severity: "ERROR",
        error: "queue-image-delete-failed",
        path: objectPath,
        message: err && err.message,
        hinweis:
          "Bild konnte nicht aktiv geloescht werden. Es faellt jetzt auf die " +
          "Lifecycle-Regel (1 Tag) zurueck — die Zusage 'unmittelbar geloescht' " +
          "ist fuer dieses Bild nicht eingehalten.",
      })
    );
    return false;
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
