import exifr from "../lib/exifr/lite.esm.mjs";

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
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_decode_failed"));
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
