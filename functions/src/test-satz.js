/* Der Einstellungssatz für Tests — an EINER Stelle.
 *
 * Seit dem 30.08.2026 kommen alle Betriebswerte aus Firestore, ohne
 * Rückfallwerte im Code. Jeder Test, der einen Code-Pfad mit Betriebswerten
 * berührt, braucht deshalb einen Satz.
 *
 * WARUM ZENTRAL: Dieselbe Regel wie für den Produktivcode. Stünden die 26
 * Werte in dreißig Testdateien, hätte man dreißig Kopien, die auseinander
 * laufen — und ein neues Pflichtfeld müsste dreißigmal nachgetragen werden.
 *
 * Die Werte entsprechen dem Satz `t1-normal`, also dem echten Betrieb.
 */
const SATZ = {
  /* KI-Aufrufe */
  mistralTimeoutMs: 90000,
  singleLargeTimeoutMs: 300000,
  singleLargeMaxTokens: 5000,
  describeMaxTokens: 2048,
  profileMaxTokens: 16000,
  requestBudgetMs: 480000,
  /* Andrang und Einlass */
  parallelitaet: 7,
  warteschlangeTiefe: 155,
  durchschnittsdauerSekunden: 65,
  stundenlimit: 500,
  stundenfensterMinuten: 60,
  adressLimit: 500,
  adressfensterMs: 600000,
  /* Notaufschlag */
  boostFaktor: 2,
  boostFristMs: 7200000,
  /* Drosselung */
  drosselMaxParallel: 6,
  drosselWartelimitMs: 360000,
  tokenAbstandGrossMs: 800,
  tokenAbstandKleinMs: 2500,
  /* Fristen */
  jobAufbewahrungMs: 7200000,
  zustellfensterMs: 900000,
  livenessGnadenfristMs: 480000,
  verarbeitungsZeitlimitMs: 540000,
  wartendesHoechstalterMs: 2100000,
  aufraeumStapel: 200,
  ticketGueltigkeitMs: 1800000,
};

/* Fertiger Mock für jest.mock("../betriebsprofil", ...).
   Als Funktion, damit die Jest-Hoisting-Regel eingehalten wird: Innerhalb der
   Mock-Factory darf nur `require` stehen, keine äußere Variable. */
function betriebsprofilMock(ueberschreiben) {
  const werte = {
    ...SATZ,
    /* KEINE echte Drosselung im Test.
       Die Abstände zwischen Mistral-Aufrufen (800/2500 ms) sind im Betrieb
       richtig und in Tests reine Wartezeit: Nach der Umstellung brauchte
       allein mistral.test.js 148 Sekunden statt weniger als einer. Geprüft
       wird die Drosselung dort, wo sie hingehört — in throttle.test.js und in
       ohne-einstellungssatz.test.js. */
    tokenAbstandGrossMs: 0,
    tokenAbstandKleinMs: 0,
    ...(ueberschreiben || {}),
  };
  return {
    geltendeWerte: async () => ({ werte, quelle: "firestore", profil: "test", grund: null }),
    PFLICHTFELDER: Object.keys(SATZ),
    _cacheLeeren: () => {},
    _pruefe: () => null,
  };
}

module.exports = { SATZ, betriebsprofilMock };
