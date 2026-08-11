export const state = {
  gpsMapInstance: null,
  isAnalyzing: false,
  currentAbortController: null,
  pendingGeocode: null,
  geocodeAbortController: null,
  lastPrepared: null,
  lastFile: null,
  lastData: null,
  requestId: 0,
  lastTraceId: null,
  /* Promise des /api/stats-Aufrufs. analyzeImage wartet darauf, bevor der
     Upload startet (Wartungsmodus und Stundenlimit stehen dort drin). */
  statsReady: null,
  /* Die geparste /api/stats-Antwort vom Seitenstart. Der Realitäts-Check
     liest daraus den anonymen Gesamtzähler (realitaetsCheck.eingaben /
     mittelProzent) für den Vergleichsbalken ab 100 Eingaben. */
  statsDaten: null,
  /* Zeitpunkt der letzten erfolgreichen Statusabfrage. Die Hintergrund-
     Wiederaufnahme entscheidet daran, ob die Schleife steckengeblieben ist.
     Frueher wurde das Feld nur ad hoc in api.js gesetzt und war hier gar nicht
     deklariert — dadurch war beim ZWEITEN Foto immer ein uralter Wert drin und
     die Wiederaufnahme feuerte, obwohl gerade ein Upload lief (Audit UX-001). */
  lastPollOk: 0,
  /* Ein Upload ist unterwegs, hat aber noch keine Job-Nummer zurueck. In diesem
     Fenster darf die Hintergrund-Wiederaufnahme NICHT dazwischenfunken — sonst
     verdraengt sie den laufenden Durchgang und rendert das vorige Ergebnis
     neben dem neuen Foto (Audit UX-001). */
  uploadLaeuft: false,
};
