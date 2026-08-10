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
  /* Promise des /api/stats-Aufrufs. analyzeImage wartet darauf, damit die
     Pfad-Wahl (Sync vs. Queue) nicht gegen den Flag-Abruf rennt. */
  statsReady: null,
};
