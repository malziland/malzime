/**
 * Schalter, die nur fuer lokale Laeufe gedacht sind — und der Riegel, der sie
 * von der Produktion fernhaelt (OPS-2026-10-03-09).
 *
 *   MISTRAL_MOCK=1   Attrappe statt der echten KI (kostenlose Tests, Durchklick)
 *   QUEUE_LOCAL=1    lokaler Ersatz fuer Cloud Tasks und den Foto-Speicher
 *   NTFY_STUMM=1     keine Benachrichtigung verschicken
 *
 * In der Produktion waere jeder davon ein Schaden, den niemand bemerkt: Mit der
 * Attrappe bekaeme jedes Foto dasselbe erfundene Profil, mit der lokalen
 * Warteschlange ginge kein Auftrag an Cloud Tasks, mit der stummen
 * Benachrichtigung bliebe das Handy still. "Niemals in Produktion" stand bisher
 * nur in der Doku. Jetzt gilt es im Programm, auf zwei Wegen:
 *
 *   1. Jede Lesestelle fragt lokalSchalterAn() — in der Produktion ist die
 *      Antwort immer "aus", egal was in der Umgebung steht.
 *   2. index.js ruft beim Laden verweigereLokalSchalterInProduktion(). Steht
 *      ein Schalter in der Produktion auf 1, startet die neue Fassung nicht;
 *      die Auslieferung scheitert sichtbar, die alte Fassung laeuft weiter.
 *
 * WORAN DIE PRODUKTION ERKANNT WIRD: Cloud Run setzt K_SERVICE in jeder
 * Instanz. Der Firebase-Emulator setzt K_SERVICE ebenfalls, dazu aber
 * FUNCTIONS_EMULATOR=true. Ein Testlauf oder ein Skript am eigenen Rechner
 * setzt keines von beiden.
 */

const NUR_LOKAL = Object.freeze(["MISTRAL_MOCK", "QUEUE_LOCAL", "NTFY_STUMM"]);

function laeuftInProduktion(env = process.env) {
  return Boolean(env.K_SERVICE) && env.FUNCTIONS_EMULATOR !== "true";
}

/**
 * Ist der lokale Schalter `name` an? Nur der Wert "1" schaltet ein, und in der
 * Produktion nie. Ein Name ausserhalb der Liste ist ein Programmierfehler und
 * wirft — sonst liesse sich die Liste umgehen, indem man sie nicht pflegt.
 */
function lokalSchalterAn(name, env = process.env) {
  if (!NUR_LOKAL.includes(name)) {
    throw new Error(`"${name}" ist kein lokaler Schalter (bekannt: ${NUR_LOKAL.join(", ")})`);
  }
  return env[name] === "1" && !laeuftInProduktion(env);
}

/**
 * Wirft, wenn in der Produktion ein lokaler Schalter auf 1 steht. Nennt alle
 * betroffenen Namen auf einmal, damit die Meldung im Auslieferungs-Protokoll
 * fuer sich allein verstaendlich ist.
 */
function verweigereLokalSchalterInProduktion(env = process.env) {
  if (!laeuftInProduktion(env)) return;
  const gesetzt = NUR_LOKAL.filter((name) => env[name] === "1");
  if (gesetzt.length === 0) return;
  throw new Error(
    `Start verweigert: In der Produktion steht ${gesetzt.join(", ")} auf 1. ` +
      "Diese Schalter sind nur fuer lokale Laeufe gedacht (functions/.env.local). " +
      "Aus den Einstellungen des Dienstes entfernen und neu ausliefern."
  );
}

module.exports = { NUR_LOKAL, laeuftInProduktion, lokalSchalterAn, verweigereLokalSchalterInProduktion };
