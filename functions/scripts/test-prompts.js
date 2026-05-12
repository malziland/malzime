/* Test-Prompts fuer das Compare-Tool.
   Ab v1.5.0 (Phase 1 Mistral-Migration) sind die ehemals hier definierten
   AGE_ANCHOR- und SCHEMA_RULES-Bloecke in die Live-Prompts gewandert
   (functions/src/locales/de/prompts.js). Diese Datei ist jetzt nur noch ein
   Pass-Through, damit compare-models.js und test-prompts.js wirklich die
   Live-Prompts gegen Anbieter vergleichen — kein Doppelt-Anker mehr. */

module.exports = require("../src/locales/de/prompts.js");
