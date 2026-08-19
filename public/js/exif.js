import exifr from "../lib/exifr/lite.esm.mjs";

/* Erkennt die Formatklasse eines Bildes an den ersten Bytes ("Magic Bytes").
   Dient der Diagnose, WAS hochgeladen wurde, wenn der Browser ein Bild nicht
   oeffnen kann (image_decode_failed) — z.B. heic von einem Nicht-Apple-Geraet.
   Arbeitet auf den bereits gelesenen Bytes: kein Dateiname, kein Bildinhalt,
   nur die Format-Art. Exportiert fuer Tests. */
export function sniffFormat(bytes) {
  try {
    const buf = bytes.slice(0, 16);
    if (buf.length < 12) return "leer";
    const hex4 = [...buf.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const at8 = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
    if (buf[0] === 0xff && buf[1] === 0xd8) return "jpeg";
    if (hex4 === "89504e47") return "png";
    if (hex4 === "47494638") return "gif";
    if (hex4 === "52494646" && at8 === "WEBP") return "webp";
    if (hex4 === "49492a00" || hex4 === "4d4d002a") return "tiff";
    if (buf[0] === 0x42 && buf[1] === 0x4d) return "bmp";
    /* ISO-BMFF (HEIC/HEIF/AVIF): Byte 4-7 = "ftyp", danach die Marke. */
    if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
      const brand = at8.toLowerCase();
      if (brand.startsWith("hei") || brand.startsWith("mif") || brand.startsWith("msf")) return "heic";
      if (brand.startsWith("avi")) return "avif";
      return "isobmff-" + brand.replace(/[^a-z0-9]/g, "");
    }
    return "unbekannt";
  } catch (_) {
    return "lesefehler";
  }
}

/* Kurze Pause zwischen den beiden Leseversuchen — als Konstante, damit Tests
   sie nicht raten muessen. */
export const READ_RETRY_DELAY_MS = 400;

/* Liest die Datei EINMAL komplett in den Speicher — sofort und mit einem
   automatischen zweiten Versuch. Hintergrund (Vorfall 2026-07-06): Manche
   Android-Geraete uebergeben der Seite eine Datei-Referenz, deren Inhalt der
   Browser nicht (mehr) lesen kann — z.B. nach Speicherdruck, bei Cloud-only-
   Fotos oder defekten Galerie-Apps. Frueher scheiterte dann erst der Bild-
   Decoder und die Meldung riet faelschlich zu "JPEG oder PNG". Jetzt schlaegt
   der Lesefehler frueh, eindeutig und mit Diagnose-Daten auf (read_failed),
   und alle weiteren Schritte arbeiten auf der In-Memory-Kopie, die nicht mehr
   kaputtgehen kann. */
async function readFileBytes(file) {
  try {
    return await file.arrayBuffer();
  } catch (_) {
    await new Promise((r) => setTimeout(r, READ_RETRY_DELAY_MS));
    try {
      return await file.arrayBuffer();
    } catch (err) {
      const wrapped = new Error("read_failed");
      wrapped.errorDetail = (err && err.name) || "ReadError";
      /* Browser-deklarierter MIME-Typ statt Magic Bytes — mehr haben wir bei
         einer unlesbaren Datei nicht. */
      wrapped.fileFormat = "decl:" + (file.type || "ohne-mime");
      wrapped.fileSizeKb = Math.round((file.size || 0) / 1024);
      throw wrapped;
    }
  }
}

export async function prepareImage(file) {
  const buffer = await readFileBytes(file);
  const bytes = new Uint8Array(buffer);

  /* EXIF im Browser parsen — GPS bleibt lokal, nur Kamera-Daten an Server */
  let exif = {};
  let gps = null;
  let dateTimeOriginal = null;
  try {
    const tags = await exifr.parse(buffer, { gps: true, silentErrors: true });
    if (tags) {
      if (tags.Make) exif.make = String(tags.Make).trim();
      if (tags.Model) exif.model = String(tags.Model).trim();
      /* SEC-002: dateTimeOriginal bleibt im Browser — wird NICHT an den Server gesendet.
         Client injiziert es nach der Analyse selbst in die Response-Daten. */
      if (tags.DateTimeOriginal) {
        dateTimeOriginal =
          tags.DateTimeOriginal instanceof Date ? tags.DateTimeOriginal.toISOString() : String(tags.DateTimeOriginal);
      }
      if (tags.latitude != null && tags.longitude != null) {
        gps = { latitude: tags.latitude, longitude: tags.longitude };
      }
    }
  } catch (_) {
    /* EXIF parse failed — continue without */
  }

  /* Bild via Canvas komprimieren — aus der In-Memory-Kopie, nicht aus der
     Datei-Referenz (siehe readFileBytes). */
  const bild = await new Promise((resolve, reject) => {
    const blob = new Blob([bytes], { type: file.type || "image/jpeg" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      /* Diagnose: festhalten, welche Formatklasse der Browser nicht oeffnen konnte. */
      const err = new Error("image_decode_failed");
      err.fileFormat = sniffFormat(bytes);
      err.errorDetail = "decode";
      err.fileSizeKb = Math.round((file.size || 0) / 1024);
      reject(err);
    };
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_DIM = 1280;
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        const scale = MAX_DIM / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("image_decode_failed"));
        return;
      }
      /* Hochwertiges Resampling beim Verkleinern — sonst verschmiert der Canvas
         feine Details (Hautstruktur, feine Linien), die die KI fuer die
         Altersschaetzung braucht. */
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, width, height);

      /* BUG-2026-08-19-01, Teil 1 von 2: Wir nehmen, was herauskam.
         Bis hierher wurde das Ergebnis als JPEG AUSGEGEBEN und in api.js auch
         so ANGEKUENDIGT. Am 19.08. lieferte ein iPhone beim zweiten Bild
         derselben Sitzung PNG — die Ankuendigung war damit gelogen, und die
         inhaltliche Pruefung des Servers (SEC-2026-08-12-19) wies zu Recht mit
         400 ab. Fuer den Menschen davor: "die Seite funktioniert nicht".

         `toDataURL` darf laut Norm auf PNG zurueckfallen, wenn der gewuenschte
         Typ nicht geliefert werden kann. Statt zu raten, WARUM ein fremder
         Browser das tut, lesen wir den Typ aus dem Ergebnis ab. Der Server
         erlaubt PNG ohnehin (ALLOWED_MIME) und prueft weiterhin den Inhalt —
         diese Aenderung schwaecht also nichts ab, sie hoert nur auf zu
         behaupten. */
      const datenUrl = canvas.toDataURL("image/jpeg", 0.82);
      const typ = /^data:([^;,]+)/.exec(datenUrl);

      /* BUG-2026-08-19-01, Teil 2 von 2: den Canvas freigeben.
         Der Fehler trat beim ZWEITEN Bild derselben Sitzung auf, nicht beim
         ersten. iOS Safari raeumt Canvas-Speicher nicht sofort ab; ist die
         Obergrenze erreicht, misslingt die JPEG-Kodierung und der Browser
         faellt zurueck. Ein Canvas auf 0x0 zu setzen ist der uebliche Weg, den
         Speicher sofort freizugeben — er kostet nichts und nimmt der Ursache
         die Grundlage, unabhaengig davon, ob sie genau so aussieht. */
      canvas.width = 0;
      canvas.height = 0;

      resolve({
        base64: datenUrl.split(",")[1] || "",
        mimeType: typ ? typ[1] : "image/jpeg",
      });
    };
    img.src = url;
  });

  /* Der Dateiname folgt dem Typ. Ein PNG "upload.jpg" zu nennen waere dieselbe
     Unwahrheit eine Ebene tiefer — sie faellt nur nicht auf, weil der Server
     den Namen nicht prueft. Kein Grund, ihn falsch zu setzen. */
  const endung = { "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[bild.mimeType] || "jpg";

  return {
    imageBase64: bild.base64,
    mimeType: bild.mimeType,
    dateiname: `upload.${endung}`,
    exif,
    dateTimeOriginal,
    gps,
  };
}
