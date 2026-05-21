import exifr from "../lib/exifr/lite.esm.mjs";

/* Erkennt die Formatklasse einer Datei an ihren ersten Bytes ("Magic Bytes").
   Dient der Diagnose, WAS hochgeladen wurde, wenn der Browser ein Bild nicht
   oeffnen kann (image_decode_failed) — z.B. heic von einem Nicht-Apple-Geraet.
   Liest nur die ersten 16 Byte: kein Dateiname, kein Bildinhalt, nur die
   Format-Art. */
async function sniffFileFormat(file) {
  try {
    const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer());
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

export async function prepareImage(file) {
  /* EXIF im Browser parsen — GPS bleibt lokal, nur Kamera-Daten an Server */
  let exif = {};
  let gps = null;
  let dateTimeOriginal = null;
  try {
    const tags = await exifr.parse(file, { gps: true, silentErrors: true });
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

  /* Bild via Canvas komprimieren */
  const imageBase64 = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = async () => {
      URL.revokeObjectURL(url);
      /* Diagnose: festhalten, welche Formatklasse der Browser nicht oeffnen konnte. */
      const err = new Error("image_decode_failed");
      err.fileFormat = await sniffFileFormat(file);
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
      resolve(canvas.toDataURL("image/jpeg", 0.82).split(",")[1] || "");
    };
    img.src = url;
  });

  return { imageBase64, exif, dateTimeOriginal, gps };
}
