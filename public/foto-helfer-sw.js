/* foto-helfer-sw.js — Ausweichweg fuer ein Foto, das der Browser nicht lesen will.

   WARUM ES DAS GIBT (09.11.2026, am Android-Pruefgeraet nachgestellt):
   Chrome auf Android merkt sich bei der Auswahl die Zeitangabe des Fotos.
   Raeumt Android die Datei danach neu an (Speicherdruck auf kleinen Geraeten,
   Neustart des Medienanbieters), traegt sie eine neue Zeit; Chrome haelt sie
   fuer veraendert und verweigert JEDEN Lesezugriff der Seite
   (NotReadableError). Das Hochladen laeuft in Chrome aber ueber einen anderen
   Weg, und der kommt durch. Diese Datei faengt genau so ein "Hochladen" ab,
   bevor es das Geraet verlaesst, und gibt die Bytes an die Seite zurueck.

   DATENSCHUTZ: Das Foto verlaesst das Geraet auf diesem Weg NIE. Die Seite
   schickt nur, wenn diese Datei sie nachweislich steuert
   (navigator.serviceWorker.controller, siehe js/foto-helfer.js); hier wird die
   Anfrage immer beantwortet und nie ans Netz weitergereicht. Alle anderen
   Anfragen der Seite fasst diese Datei nicht an.

   KEIN DAUERHAFTER SPEICHER: Die Seite meldet diese Datei gleich nach dem
   Start wieder ab (js/foto-helfer.js). Sie arbeitet nur, solange der Tab
   offen ist; danach entfernt der Browser sie. */

/* global self, URL, Response */

/* Nie erreichbare Adresse (RFC 6761), Begruendung in js/foto-helfer.js. */
const ZIEL = "https://foto-lokal.invalid/foto";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  /* Sofort die schon offene Seite steuern — sonst wirkt der Ausweichweg erst
     nach einem Neuladen. */
  event.waitUntil(self.clients.claim());
});

/* Ein weiterer Tab, den die Hilfsdatei nicht von selbst steuert, bittet per
   Nachricht darum (js/foto-helfer.js, ZWEITER TAB). */
self.addEventListener("message", (event) => {
  if (event.data === "uebernehmen") event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const anfrage = event.request;
  if (anfrage.method !== "POST") return;
  let adresse;
  try {
    adresse = new URL(anfrage.url);
  } catch {
    return;
  }
  if (adresse.href !== ZIEL) return;
  event.respondWith(fotoZurueck(anfrage));
});

async function fotoZurueck(anfrage) {
  try {
    const formular = await anfrage.formData();
    const datei = formular.get("foto");
    if (!datei || typeof datei.arrayBuffer !== "function") {
      return new Response(null, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const bytes = await datei.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" },
    });
  } catch (err) {
    /* Nur der Fehlername geht an die Seite, kein Inhalt. */
    const name = (err && err.name) || "Fehler";
    return new Response(null, { status: 422, headers: { "Cache-Control": "no-store", "X-Foto-Fehler": name } });
  }
}
