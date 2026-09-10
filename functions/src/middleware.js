/* PRIV-2026-09-10-07: Die Adressliste des Missbrauchsschutzes haelt eine
   IP-Adresse nur fuer die Dauer ihres Zeitfensters (Einstellungssatz:
   adressfensterMs). Vorher raeumte sie nur beim naechsten Aufruf auf, und das
   hoechstens alle 60 s — kam kein Aufruf mehr, blieb eine Adresse unbegrenzt
   im Arbeitsspeicher, obwohl die Datenschutzerklaerung eine Hoechstdauer nennt.

   Jetzt zwei Wege, die sich ergaenzen:
   1. Jeder Eintrag bekommt einen eigenen Zeitgeber, der ihn zum Ende seines
      Fensters loescht, auch ohne weiteren Aufruf. `unref()`, damit er den
      Prozess nicht wach haelt.
   2. Jeder Aufruf loescht vorher ALLE abgelaufenen Eintraege. Grund: Cloud Run
      kann die CPU zwischen zwei Anfragen drosseln, dann laufen Zeitgeber
      verspaetet. Deshalb sagt der Text "rund 10 Minuten": best effort per
      Zeitgeber, sicher geloescht spaetestens beim naechsten Aufruf.

   Ein abgelaufener Eintrag zaehlt nie mit. Das Fenster endet bei `resetAt`
   (ausschliesslich) — dieselbe Grenze, an der der Zeitgeber feuert. */
const rateState = new Map();
const MAX_RATE_ENTRIES = 10000;

function getClientIp(req) {
  /* SEC-001: req.ip wird von Express/Firebase korrekt aus dem Load-Balancer-Header
     geparst. Manuelles x-forwarded-for-Parsing ist spoofbar (Angreifer setzt
     eigenen Wert als ersten Eintrag). */
  return req.ip || "unknown";
}

function entferneEintrag(key, entry) {
  clearTimeout(entry.zeitgeber);
  /* Nur loeschen, wenn unter dem Schluessel noch DIESER Eintrag steht — ein
     verspaeteter Zeitgeber darf keinen neueren Eintrag derselben Adresse
     entfernen. */
  if (rateState.get(key) === entry) rateState.delete(key);
}

/* Dank der Zeitgeber haelt die Liste normalerweise nur Adressen im laufenden
   Fenster; der Durchlauf ist deshalb kurz (Obergrenze MAX_RATE_ENTRIES). */
function loescheAbgelaufene(jetzt) {
  for (const [key, entry] of rateState) {
    if (jetzt >= entry.resetAt) entferneEintrag(key, entry);
  }
}

/**
 * Adress-Limit.
 *
 * Grenze und Zeitfenster kommen seit 30.08.2026 aus dem Einstellungssatz und
 * werden als Parameter hereingereicht. Bewusst NICHT selbst aus der Datenbank
 * gelesen: Diese Funktion sitzt im Eingang jeder Anfrage und muss synchron und
 * ohne Netzzugriff bleiben. Die Aufrufer sind ohnehin asynchron und holen die
 * Werte einmal.
 *
 * Fehlen die Werte, gelten die Konstanten aus config.js. Anders als bei den
 * Zeitgrenzen ist der Rueckfall hier richtig: Das Adress-Limit ist eine
 * Schutzgrenze — ohne sie waere der Eingang offen.
 */
function checkRateLimit(key, grenze, fensterMs) {
  /* Grenze und Fenster sind Pflicht — sie kommen aus dem Einstellungssatz.
     Ein Rueckfall auf eine Konstante waere eine zweite Definition derselben
     Zahl gewesen. */
  if (typeof grenze !== "number" || !(grenze > 0)) throw new Error("checkRateLimit: adressLimit fehlt");
  if (typeof fensterMs !== "number" || !(fensterMs > 0)) throw new Error("checkRateLimit: adressfensterMs fehlt");
  const limit = grenze;
  const fenster = fensterMs;
  const current = Date.now();
  loescheAbgelaufene(current);
  const entry = rateState.get(key);
  if (!entry) {
    /* LRU-Cap: Wenn Map voll, ältesten Eintrag entfernen */
    if (rateState.size >= MAX_RATE_ENTRIES) {
      const [aeltesterKey, aeltester] = rateState.entries().next().value;
      entferneEintrag(aeltesterKey, aeltester);
    }
    const neu = { count: 1, resetAt: current + fenster, zeitgeber: null };
    neu.zeitgeber = setTimeout(() => entferneEintrag(key, neu), fenster);
    neu.zeitgeber.unref();
    rateState.set(key, neu);
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

/* `_rateState` nur fuer die Pruefung (middleware.test.js): Sie muss sehen,
   dass ein Eintrag ohne weiteren Aufruf verschwindet. */
module.exports = { getClientIp, checkRateLimit, _rateState: rateState };
