/* foto-helfer.js — Anbindung des Ausweichwegs fuer unlesbare Fotos
   (Begruendung und Messung: ../foto-helfer-sw.js).

   Zwei Aufgaben:
   1. starteFotoHelfer(): beim Laden der Seite die Hilfsdatei anmelden und,
      sobald sie die Seite steuert, gleich wieder ABMELDEN. Eine abgemeldete
      Hilfsdatei arbeitet fuer die offene Seite weiter, bis der Tab zu ist,
      und wird dann vom Browser entfernt — die Datenschutzerklaerung sagt
      "kein dauerhafter Speicher ... Tab zu – alles weg".
   2. leseUeberHelfer(datei): das Foto ueber die Hilfsdatei holen. Geht NUR,
      wenn sie die Seite gerade steuert; sonst ginge die Anfrage ans Netz, und
      das Foto darf das Geraet nie verlassen. */

const PFAD = "/__foto-lokal";
const SKRIPT = "/foto-helfer-sw.js";

function swVorhanden() {
  return (
    typeof navigator !== "undefined" &&
    navigator.serviceWorker &&
    typeof navigator.serviceWorker.register === "function"
  );
}

/* ZWEITER TAB (09.11.2026, am Pruefgeraet gemessen): Ist die Seite schon in
   einem Tab offen, holt register() im neuen Tab die abgemeldete Hilfsdatei
   zurueck, steuert den neuen Tab aber nicht — controllerchange kam nie, und
   die Anmeldung ueberstand Schliessen und Neustart. Darum: die Hilfsdatei per
   Nachricht bitten, auch diesen Tab zu uebernehmen, hoechstens 5 s warten, und
   abmelden IMMER (finally), auch wenn die Steuerung nie kommt. */
const STEUERUNG_FRIST_MS = 5000;

export async function starteFotoHelfer() {
  let anmeldung = null;
  try {
    if (!swVorhanden()) return "kein-sw";
    anmeldung = await navigator.serviceWorker.register(SKRIPT, { scope: "/" });
    if (!navigator.serviceWorker.controller) {
      const gesteuert = new Promise((fertig) => {
        navigator.serviceWorker.addEventListener("controllerchange", fertig, { once: true });
      });
      const uebernehmen = (async () => {
        const bereit = await navigator.serviceWorker.ready;
        if (bereit && bereit.active) bereit.active.postMessage("uebernehmen");
        await gesteuert;
      })();
      await Promise.race([uebernehmen, new Promise((fertig) => setTimeout(fertig, STEUERUNG_FRIST_MS))]);
    }
    return navigator.serviceWorker.controller ? "bereit" : "nicht-gesteuert";
  } catch (_) {
    /* Bestmoeglich: ohne Hilfsdatei laeuft alles wie bisher. */
    return "fehler";
  } finally {
    if (anmeldung) {
      try {
        await anmeldung.unregister();
      } catch (_) {
        /* bestmoeglich */
      }
    }
  }
}

/* Liefert { bytes, ergebnis }. ergebnis ist ein festes Stichwort fuer die
   Fehlermeldung ("ok", "kein-helfer", "status-422:NotReadableError",
   "leer", ein Fehlername) — nie Inhalt oder Dateiname. */
export async function leseUeberHelfer(datei) {
  try {
    if (!swVorhanden() || !navigator.serviceWorker.controller) return { bytes: null, ergebnis: "kein-helfer" };
    const formular = new FormData();
    formular.append("foto", datei);
    const antwort = await fetch(PFAD, { method: "POST", body: formular, cache: "no-store" });
    if (!antwort.ok) {
      const grund = antwort.headers.get("X-Foto-Fehler") || "";
      return { bytes: null, ergebnis: `status-${antwort.status}${grund ? ":" + grund : ""}`.slice(0, 40) };
    }
    const bytes = await antwort.arrayBuffer();
    if (!bytes || bytes.byteLength === 0) return { bytes: null, ergebnis: "leer" };
    return { bytes, ergebnis: "ok" };
  } catch (err) {
    return { bytes: null, ergebnis: ((err && err.name) || "Fehler").slice(0, 40) };
  }
}
