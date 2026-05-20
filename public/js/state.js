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
  /* Queue-Architektur (v2.0): vom /api/stats-Flag beim Seitenstart gesetzt.
     Default false → bewährter synchroner Pfad, bis das Flag geladen ist. */
  useQueue: false,
  /* Promise des /api/stats-Aufrufs. analyzeImage wartet darauf, damit die
     Pfad-Wahl (Sync vs. Queue) nicht gegen den Flag-Abruf rennt. */
  statsReady: null,
};
