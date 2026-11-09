/* foto-auswahl.js — was mit einem gerade gewaehlten Foto zuerst geschieht.
   Herausgeloest am 09.11.2026 (app.js stiess an seine Groessengrenze). */

import { elements } from "./dom.js";
import { t } from "./i18n.js";
import { state } from "./state.js";
import { leseFoto, zeitsprungArt } from "./exif.js";

/* ZUERST LESEN (09.11.2026): Das gewaehlte Foto wird in den Speicher gelesen,
   BEVOR die Seite irgendetwas anderes an der Datei anfasst — Groesse, Zeit,
   Vorschau. Am Android-Pruefgeraet scheiterte der Ausweichweg fuer
   unlesbare Fotos (exif.js, ../foto-helfer-sw.js) 3 von 3, wenn Groesse und
   Zeit vorher abgefragt wurden. Die Vorschau entsteht deshalb aus den
   gelesenen Bytes, die Diagnose (Vergleich mit der vorigen Auswahl) erst
   danach — auch wenn das Lesen gescheitert ist. Liefert das Promise der
   Bytes; die Analyse wartet darauf (api.js). */
export function lesenUndVorschau(file) {
  const meineAuswahl = state.auswahlNr;
  const lesen = leseFoto(file, state.auswahlZeit);
  const nachDemLesen = () => {
    state.zeitsprung = zeitsprungArt(state.vorigeAuswahl, file);
    state.vorigeAuswahl = { name: file.name, size: file.size, lastModified: file.lastModified };
  };
  lesen.then(
    (bytes) => {
      if (state.auswahlNr !== meineAuswahl) return;
      nachDemLesen();
      if (!elements.imagePreview) return;
      const img = document.createElement("img");
      img.src = URL.createObjectURL(new Blob([bytes]));
      img.alt = t("preview.alt");
      elements.imagePreview.innerHTML = "";
      elements.imagePreview.appendChild(img);
    },
    () => {
      if (state.auswahlNr === meineAuswahl) nachDemLesen();
    }
  );
  return lesen;
}
