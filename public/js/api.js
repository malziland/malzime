import { elements } from "./dom.js";
import { state } from "./state.js";
import { prepareImage } from "./exif.js";
import { startGeocoding } from "./geocoding.js";
import {
  setStatus,
  textSetzen,
  startScanAnim,
  stopScanAnim,
  showLimitBanner,
  showMaintenanceModal,
  resetQueueWaiting,
} from "./ui.js";
import { renderCurrentMode } from "./render.js";
import * as liveAnzeige from "./live-anzeige.js";
import * as realitaetsCheck from "./realitaets-check.js";
import { t, getLanguage } from "./i18n.js";
import { logClientError } from "./error-logger.js";
import { logTelemetry } from "./telemetry-logger.js";
import { PROFIL_FERTIG } from "./beast-lockruf.js";
import { generateTraceId } from "./client-context.js";
import { apiUrl } from "./api-basis.js";
import { sleep, fetchWithTimeout } from "./netz-hilfen.js";
import { pollJob, JOB_STATUS_URL, MAX_POLL_DURATION_MS } from "./auftrag-abfrage.js";
import { vorschauAusErgebnisFallsNoetig, showPhotoDeletedNotice } from "./foto-vorschau.js";
import { acquireWakeLock, releaseWakeLock, wakeLockStatus } from "./wake-lock.js";
import {
  storeJobId,
  markiereErgebnisZustellung,
  ergebnisFristAbgelaufen,
  clearStoredJobId,
  getStoredJobId,
  getStoredResultToken,
  offenerAuftrag,
} from "./auftrag-speicher.js";

/* Wake-Lock und Auftragsgedächtnis liegen seit 10.09.2026 in eigenen Modulen
   (js/wake-lock.js, js/auftrag-speicher.js). app.js und die Tests holen diese
   drei weiter hier. Seit 07.10.2026 ebenso herausgelöst: die Statusabfrage
   (js/auftrag-abfrage.js), die Netz-Hilfen (js/netz-hilfen.js) und die zwei
   Handgriffe an der Foto-Vorschau (js/foto-vorschau.js) — unverändert, nur an
   eigenem Ort; hier bleibt der Ablauf: einreihen, abholen, wiederaufnehmen. */
export { acquireWakeLock, clearStoredJobId, getStoredJobId };

const PAGE_LOADED_AT = Date.now();
const MIN_INTERACTION_MS = 2000;

/* SICHTBAR HEISST GEMELDET (16.09.2026): Sechs Fehlermeldungen, die ein Kind
   auf dem Bildschirm sieht, gingen nie an die Fehlererfassung — die Auswertung
   des Workshop-Tags konnte deshalb nur die Faelle zaehlen, die ohnehin gemeldet
   wurden. Die Meldung traegt den Schluessel des angezeigten Textes als
   Fehlerart; weitere Felder nur aus der festen Liste des Melders. */
function meldeSichtbarenFehler(schluessel, phase, zusatz = {}) {
  logClientError(new Error(schluessel), { phase, wakeLock: wakeLockStatus(), ...zusatz });
}

/* Fehlerweg: Live-Anzeige weg UND die waehrend des Laufs schon gezeigten
   Kategorie-Karten — neben der Fehlermeldung saehen sie aus wie ein halbes
   Profil (Fund der Pruefrunde 01.10.2026). Nicht in liveAnzeige.abbrechen():
   Das laeuft auch nach dem Rendern eines fertigen Ergebnisses. */
function liveAbbrechenWegenFehler() {
  liveAnzeige.abbrechen();
  if (elements.facts) elements.facts.innerHTML = "";
}

/* v3.0.0: Das frühere Hinweis-Pop-up vor der Analyse ist ersatzlos entfernt
   (bewusste Entscheidung: „dieses Pop-Up liest sowieso keiner durch") —
   die Analyse startet direkt bei der Foto-/Demo-Wahl. Die Einordnung „nichts
   davon ist wahr" trägt weiterhin die Disclaimer-Box auf der Seite, im
   Ergebnis und im PDF. */
export async function analyzeImage() {
  if (state.isAnalyzing) return;
  /* Voriges Ergebnis ist ab jetzt ungueltig. Das Kleben des Umschalters haengt
     seit v3.9.0 NICHT mehr daran — er klebt immer. Das Merkmal sagt jetzt nur
     noch, ob ein fertiges Profil dasteht: Daran haengt der Beast-Lockruf
     (js/beast-lockruf.js), der nach einem Fehler nicht auf ein Ergebnis zeigen
     darf, das es nicht gibt. */
  document.documentElement.removeAttribute("data-has-result");
  /* Sofort sichtbares Feedback, bevor irgendetwas ueber die Leitung geht.
     FIX 1 (v3.0.1): mit Text — Auge+Balken standen sonst bis zur ersten
     Warteschlangen-Antwort mehrere Sekunden stumm da (der Upload dauert). */
  startScanAnim(false);
  textSetzen(elements.scanText, t("scan.upload"));
  /* Kurz auf /api/stats warten: Dort stehen Wartungsmodus und Stundenlimit.
     Loest dank Timeout in app.js immer zeitnah auf. */
  if (state.statsReady) await state.statsReady;
  if (state.isAnalyzing) return;
  return analyzeImageQueued();
}

/* ── Warteschlange — der einzige Weg (seit v2.10) ────────────────────
   Bild an /api/enqueue, danach /api/job-status alle 2 s abfragen. Jede
   Abfrage ist zugleich der Lebenszeichen-Herzschlag (siehe Backend).

   Der frühere synchrone Weg — eine 30-60 s offene Verbindung — ist mit v2.10
   entfernt. Er war seit Mai 2026 nur noch Rückfall über ein Feature-Flag und
   hätte bei Stoßlast genau das Problem zurückgebracht, wegen dem die
   Warteschlange gebaut wurde: lange offene Verbindungen brechen weg, und der
   Bildschirm-Wachhalter greift auf iPhones nicht. */

/* Adresse aus api-basis.js: im Betrieb direkt Cloud Run (EU), sonst relativ.
   Die Adresse der Statusabfrage und ihre Grenzen stehen bei der Abfrage
   selbst (js/auftrag-abfrage.js). */
const ENQUEUE_URL = apiUrl("/api/enqueue");
/* Zeitgrenze fuers Einreihen: Der Client darf nie vor dem Server aufgeben
   (enqueue-Function 60 s), aber ein Aufruf, der nie endet (Netz-Blackhole auf
   Mobilgeraeten), darf den Ablauf nicht einfrieren. */
const ENQUEUE_TIMEOUT_MS = 90000;

/* PRIV-2026-10-03-57: Meldet dem Server einen Auftrag ab, den dieser Tab
   nicht mehr abholt (ein anderes Foto wurde gewaehlt). Wartet der Auftrag
   noch, verwirft ihn der Server sofort: kein KI-Aufruf, der Platz im
   Stundenkontingent wird frei, das Bild geloescht. Laeuft er schon, aendert
   die Abmeldung nichts. Ohne Abhol-Ticket nimmt der Server sie nicht an.
   Bestmoeglich und still: Scheitert sie, raeumt der Server den Auftrag wie
   bisher nach seiner Karenz selbst ab.
   Abgemeldet wird dort, wo die Nummer eines noch offenen Auftrags faellt:
   beim Start jedes neuen Durchgangs (was der Tab bis dahin gemerkt hatte —
   auch wenn zuletzt eine Wiederaufnahme den Auftrag fuehrte), wenn das Geraet
   so lange weg war, dass es als weitergereicht gilt, und wenn ein Auftrag erst
   zurueckkommt, nachdem schon ein anderes Foto gewaehlt wurde. */
function meldeAuftragAb(jobId, resultToken) {
  if (!jobId || !resultToken) return;
  try {
    fetch(`${JOB_STATUS_URL}?jobId=${encodeURIComponent(jobId)}&token=${encodeURIComponent(resultToken)}`, {
      method: "DELETE",
      cache: "no-store",
      keepalive: true,
    }).catch(() => {});
  } catch (_) {
    /* Abmelden ist ein Zusatz — nie ein Grund fuer eine Fehlermeldung. */
  }
}

/* Meldet ab, was der Tab gemerkt hat und noch nicht bekommen hat. Ein Auftrag,
   dessen Ergebnis schon auf dem Bildschirm stand, braucht das nicht. */
function meldeOffenenAuftragAb() {
  const offen = offenerAuftrag();
  if (offen) meldeAuftragAb(offen.jobId, offen.resultToken);
}

/* ── Warten auf die Verbindung (BUG-2026-10-03-46) ──────────────────────
   Nach MAX_POLL_FAILURES gescheiterten Abfragen sagt die Seite zu, die
   Analyse erscheine automatisch. Eingeloest wurde das nur, wenn der Browser
   „wieder online" meldete oder der Tab sichtbar wurde. In einem wackeligen
   Schul-WLAN meldet sich der Browser aber oft gar nicht als getrennt (WLAN
   verbunden, Internet weg) — dann kam nie ein Ereignis, und die Seite stand.

   Deshalb prueft die Seite, solange sie wartet, von selbst nach: alle zwoelf
   Sekunden EINE stille Statusabfrage. Erst wenn die gelingt, startet die
   gewohnte Wiederaufnahme — bis dahin aendert sich auf dem Bildschirm nichts,
   und die Fehlererfassung bekommt fuer das Weiterwarten keine Meldungen.

   Die stille Abfrage geht OHNE Abhol-Ticket hinaus: Der Server nennt dann nur
   den Stand und stellt kein Ergebnis zu (das Einmal-Ticket fuer den
   Realitaets-Check und die Zustellfrist bleiben unberuehrt). Abgeholt wird
   danach auf dem gewohnten Weg, mit Ticket.

   Obergrenze wie beim Abfragen (MAX_POLL_DURATION_MS ab dem ersten Abriss):
   Kein Tab fragt stundenlang. Danach bleiben „wieder online", der Tab-Wechsel
   und das Neuladen als Wege zum Ergebnis. */
const VERBINDUNG_PRUEF_ABSTAND_MS = 12000;
const VERBINDUNG_PRUEF_TIMEOUT_MS = 10000;
let verbindungsPruefer = null;
let wartetAufVerbindungSeit = 0;

function verbindungsPruefungStoppen() {
  clearTimeout(verbindungsPruefer);
  verbindungsPruefer = null;
}

/* Wird gerufen, sobald ein Durchgang an der Verbindung haengen bleibt. */
function verbindungsPruefungStarten() {
  if (!wartetAufVerbindungSeit) wartetAufVerbindungSeit = Date.now();
  verbindungsPruefungStoppen();
  verbindungsPruefer = setTimeout(pruefeVerbindung, VERBINDUNG_PRUEF_ABSTAND_MS);
}

async function pruefeVerbindung() {
  verbindungsPruefer = null;
  const jobId = getStoredJobId();
  if (!state.wartetAufVerbindung || state.uploadLaeuft || !jobId) return;
  if (Date.now() - wartetAufVerbindungSeit > MAX_POLL_DURATION_MS) return;
  const stand = state.requestId;
  let erreichbar = false;
  try {
    const resp = await fetchWithTimeout(
      `${JOB_STATUS_URL}?jobId=${encodeURIComponent(jobId)}`,
      { cache: "no-store" },
      VERBINDUNG_PRUEF_TIMEOUT_MS
    );
    if (resp.status === 404) {
      /* Der Server antwortet, der Auftrag ist weg — die Wiederaufnahme raeumt auf. */
      erreichbar = true;
    } else if (resp.ok) {
      /* Nur eine echte Antwort des eigenen Servers zaehlt. Die Anmeldeseite
         eines Schul-WLANs antwortet auch mit „200", aber nicht mit einem Stand. */
      const daten = await resp.jsonMitTimeout();
      erreichbar = Boolean(daten && typeof daten.status === "string");
    }
  } catch (_) {
    /* Weiter keine Verbindung — gleich noch einmal pruefen. */
  }
  /* Waehrend der Abfrage kann ein neues Foto, „wieder online" oder ein
     Tab-Wechsel uebernommen haben. Dann ist hier nichts mehr zu tun. */
  if (!state.wartetAufVerbindung || state.requestId !== stand || getStoredJobId() !== jobId) return;
  if (erreichbar) resumeQueueJob({ force: true });
  else verbindungsPruefungStarten();
}

/* Wie lange ohne erfolgreiche Statusabfrage, bis der Durchgang als
   steckengeblieben gilt. Zwei normale Abfrage-Intervalle plus Puffer — kurz
   genug, dass niemand lange vor einer toten Seite sitzt, lang genug, dass ein
   kurzer Tab-Wechsel keinen Neustart ausloest. */
const STECKENGEBLIEBEN_MS = 8000;

/**
 * Holt das Ergebnis nach, wenn die Seite aus dem Hintergrund zurueckkommt.
 *
 * WARUM DAS NOETIG IST: Sperrt man das Handy, friert der Browser die Seite
 * ein — nicht nur die laufende Netzwerkanfrage, sondern die JavaScript-
 * Ausfuehrung insgesamt. Beim Zurueckkommen kann die Abfrage-Schleife in einem
 * fetch feststecken, der nie zurueckkommt: kein Fehler, kein Ergebnis, kein
 * Spinner. Ein erster Anlauf hat nur die Fehlerzaehlung angefasst und genau
 * diesen stillen toten Zustand erzeugt.
 *
 * Deshalb wird hier nicht repariert, sondern neu aufgesetzt: Ist seit der
 * letzten erfolgreichen Statusabfrage zu viel Zeit vergangen, startet der
 * Durchgang neu. Der Job laeuft serverseitig ohnehin unabhaengig vom Browser
 * weiter und das Ergebnis liegt rund zwei Stunden bereit — genau dafuer wurde
 * die Warteschlange gebaut.
 */
/* PRIV-004 (Audit 2026-08-10): Obergrenze, wie lange ein fertiges Ergebnis im
   Tab abrufbar bleibt.

   Nach einer erfolgreichen Analyse bleiben Job-Nummer und Abhol-Ticket bewusst
   stehen, damit ein Neuladen das Profil wiederholt. Im Klassenzimmer wird ein
   Tablet aber weitergereicht, ohne den Tab zu schliessen — und dann sieht das
   naechste Kind das Profil des vorigen, inklusive Altersschaetzung und
   Manipulations-Triggern — ein fremdes Profil hat auf einem weitergereichten
   Geraet nichts verloren.

   Das Sicherheitsmodell fuehrte diesen Fall als abgedeckt ("Ticket lebt im Tab
   und stirbt mit ihm") — aber der Dritte im Klassenzimmer ist derselbe Tab.

   Kompromiss: Ein kurzer App-Wechsel aendert nichts (Reload-Wiederholung bleibt
   erhalten), eine laengere Pause laesst das Ticket fallen. Ein weitergereichtes
   Geraet liegt praktisch immer laenger als das hier still. */
const UEBERGABE_PAUSE_MS = 3 * 60 * 1000;
let seitWannVerborgen = 0;

export function initHintergrundWiederaufnahme() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      seitWannVerborgen = Date.now();
      return;
    }

    /* War die Seite lange genug weg, gilt das Geraet als weitergereicht. */
    if (seitWannVerborgen && Date.now() - seitWannVerborgen > UEBERGABE_PAUSE_MS) {
      seitWannVerborgen = 0;
      /* Abgeholt wird der Auftrag nicht mehr. Wartet er noch, soll der Server
         ihn gleich verwerfen statt erst nach seiner Karenz. */
      meldeOffenenAuftragAb();
      clearStoredJobId();
      /* BUG-2026-10-03-46: Wartete die Seite gerade auf die Verbindung, ist
         mit der Auftragsnummer auch die Zusage „erscheint automatisch"
         hinfaellig — abgeholt wird ab jetzt nichts mehr (das Geraet gilt als
         weitergereicht, der Naechste soll das Profil nicht sehen). Die Zusage
         darf dann nicht stehen bleiben: Die Meldung sagt, was zu tun ist. */
      if (state.wartetAufVerbindung) {
        state.wartetAufVerbindung = false;
        verbindungsPruefungStoppen();
        liveAbbrechenWegenFehler();
        stopScanAnim(true);
        textSetzen(elements.scanText, "");
        setStatus(t("error.queueAbandoned"), undefined, "error.queueAbandoned");
        meldeSichtbarenFehler("error.queueAbandoned", "uebergabe-pause");
      }
      return;
    }
    seitWannVerborgen = 0;

    /* UX-001: Ist gerade ein Upload unterwegs, der noch keine Job-Nummer hat,
       niemals dazwischenfunken. Sonst verdraengt die Wiederaufnahme den
       laufenden Durchgang (ueber state.requestId) und rendert das VORIGE
       Ergebnis neben dem NEUEN Foto — waehrend das neue Foto nie hochgeladen
       wird. Dieselbe Sperre schliesst das Fenster beim Warten auf /api/stats. */
    if (state.uploadLaeuft) return;

    if (!getStoredJobId()) return;

    /* Laeuft die Schleife normal weiter, nichts tun — der visibilitychange-
       Wecker in waitForNextPoll holt das Ergebnis von selbst.
       UX-002: Auch nach einer FERTIGEN Analyse nichts tun. Die Job-Nummer
       bleibt dann bewusst stehen (Reload soll das Ergebnis wiederholen), aber
       `isAnalyzing` ist false — ohne diese Bedingung loeste jeder Tab-Wechsel
       eine volle Wiederaufnahme samt Sprung an den Seitenanfang aus.
       v3.3.1: Ein wegen Verbindungsabbruch pausierter Durchgang zaehlt hier
       mit — dort ist `isAnalyzing` bereits false, das Ergebnis aber offen. */
    if (!state.isAnalyzing && !state.wartetAufVerbindung) return;

    const stillSeit = Date.now() - (state.lastPollOk || 0);
    if (stillSeit < STECKENGEBLIEBEN_MS) return;

    resumeQueueJob({ force: true });
  });

  /* ── „Wieder online" (v3.3.1) ──────────────────────────────────────────
     BUG-2026-08-17-02. Bei Verbindungsabbruch sagt die Meldung zu, die
     Analyse erscheine automatisch, sobald man wieder online ist. Diese Zusage
     war bis v3.3.0 ungedeckt: Die Wiederaufnahme hing allein am Tab-Wechsel
     und am Neuladen. Wer einfach sitzen blieb, bis das Netz zurueckkam,
     wartete vergeblich — die Seite tat nichts.

     Kein STECKENGEBLIEBEN_MS-Vorlauf wie oben: Dort ist offen, ob die
     Schleife noch lebt; hier ist der Ausloeser eindeutig, und jede Sekunde
     Zoegern ist eine Sekunde vor einer toten Seite. */
  window.addEventListener("online", () => {
    if (state.uploadLaeuft) return;
    if (!getStoredJobId()) return;
    /* `wartetAufVerbindung` ist hier der eigentliche Fall: Der Durchgang hat
       aufgegeben, `isAnalyzing` steht deshalb schon auf false. Ohne dieses
       Feld wuerde der Lauscher genau in der Lage nichts tun, fuer die er
       gebaut ist (siehe state.js). */
    if (!state.isAnalyzing && !state.wartetAufVerbindung) return;
    resumeQueueJob({ force: true });
  });
}

/**
 * Rendert das fertige Queue-Ergebnis (renderCurrentMode → Success-Telemetrie).
 * v3.0.0: Lief Live-Text, wird VOR dem Rendern der Rest-Puffer im
 * Schnellvorlauf ausgetippt — deshalb async. Das Rendern samt Verdecken der
 * Enthüllung bleibt danach synchron im selben Frame.
 * @param {object|null} prepared Die Aufbereitung des Fotos, zu dem dieses
 *        Ergebnis gehört (Ort und Aufnahmedatum daraus bleiben im Browser).
 */
async function renderQueueResult(data, myId, traceId, timings, prepared) {
  /* PRIV-107: Ab der ersten Zustellung läuft die Wiederholungs-Frist. */
  markiereErgebnisZustellung();
  if (!data) {
    /* Nie halben Live-Text stehen lassen — Karte weg, normale Fehlermeldung. */
    liveAbbrechenWegenFehler();
    setStatus(t("error.queueFailed"), traceId, "error.queueFailed");
    meldeSichtbarenFehler("error.queueFailed", "ergebnis-leer", { traceId, requestId: String(myId) });
    return;
  }
  /* Client-seitige Daten injizieren — GPS/dateTimeOriginal erreichen nie unsere
     Server. Nach einem Reload fehlt die Aufbereitung; dann bleibt GPS leer.
     BUG-2026-10-03-45: Eingesetzt wird die Aufbereitung DIESES Durchgangs,
     die der Aufrufer mitgibt — nicht, was gerade im gemeinsamen Zustand
     steht. */
  if (!data.exif) data.exif = {};
  if (prepared && prepared.gps) {
    data.exif.gpsLatitude = prepared.gps.latitude;
    data.exif.gpsLongitude = prepared.gps.longitude;
  }
  if (prepared && prepared.dateTimeOriginal) {
    data.exif.dateTimeOriginal = prepared.dateTimeOriginal;
  }

  const renderStart = Date.now();
  const finishRender = () => {
    if (state.requestId !== myId) return;
    state.lastData = data;
    renderCurrentMode(data);
    /* v3.1: Realitäts-Check VOR der Enthüllung aufbauen — bei einem echten
       Menschen-Profil wird die Karte sichtbar und die Enthüllung staffelt
       sie zwischen Manipulations- und Datenwert-Box mit ein; bei Tier-
       Profil, blocked oder leerem Profil bleibt sie versteckt. */
    realitaetsCheck.neuesErgebnis(data);
    /* v3.0: Lief für diesen Job Live-Text, wird das eben Gerenderte im selben
       Frame verdeckt und gestaffelt enthüllt (live-anzeige.js). Lief KEINER
       (Tier-Profil, blocked, Wiederaufnahme nach einem Neuladen), räumt
       abbrechen() höchstens eine verwaiste Live-Karte weg — der heutige Pfad
       bleibt Pixel für Pixel unverändert. */
    const liveEnthuellung = liveAnzeige.hatLiveGelaufen() && data.profiles && data.meta?.mode !== "animal";
    if (liveEnthuellung) {
      liveAnzeige.starteEnthuellung();
    } else {
      liveAnzeige.abbrechen();
      /* OHNE Enthuellung steht das Profil hier schon vollstaendig da — dann
         meldet es niemand sonst. Der Beast-Lockruf haengt sonst nur am Ende
         der Enthuellung und bliebe in genau diesen Faellen stumm: beim
         Tier-Profil und vor allem bei der Wiederaufnahme nach einem Neuladen.
         Die Wache gegen Fehlerfaelle sitzt im Empfaenger, der auf
         `data-has-result` prueft (js/beast-lockruf.js). */
      document.dispatchEvent(new CustomEvent(PROFIL_FERTIG));
    }
    setStatus("");
    /* Kein Sprung nach oben mitten in der Enthüllung — der Blick bleibt bei
       der Live-Karte („das wirkt irgendwie unnatürlich", Live-Test 11.08.).
       Ohne Live-Lauf bleibt das alte Verhalten unverändert. */
    if (!liveEnthuellung) window.scrollTo({ top: 0, behavior: "smooth" });
    /* Fokus auf das Ergebnis, damit Screenreader dort weiterlesen — aber nur,
       wenn niemand ihn inzwischen selbst bewegt hat.
       BUG-2026-09-10-01: Bis 4.8.1 zog dieser Zeitgeber den Fokus in JEDEM
       Fall auf den Ergebnisbereich. Wer in den 300 ms schon den Beast-
       Umschalter angesteuert hatte, verlor ihn mitten im Tastendruck: Die
       Leertaste ging am Schalter runter und am Ergebnisbereich hoch, und der
       Schalter blieb stehen. Nachgestellt mit angehaltener Uhr (e2e/a11y-
       fokus-nach-ergebnis.test.js); in der Pipeline dreimal als roter
       Tastatur-Test (30.08., 01.09., 10.09.). */
    const fokusBeimRendern = document.activeElement;
    setTimeout(() => {
      const jetzt = document.activeElement;
      if (jetzt !== fokusBeimRendern && jetzt !== document.body) return;
      if (elements.resultsPanel) elements.resultsPanel.focus({ preventScroll: true });
    }, 300);
    const meta = data.meta || {};
    /* BUG-2026-08-17-05: Ein `blocked`-Ergebnis IST ein Fehler — der Nutzer
       sieht die Karte „technischer Fehler", nicht sein Profil. Bis v3.3.0 lief
       genau dieser Fall ausschliesslich als `analyze-success` durch die
       Telemetrie und loeste keine einzige Fehlermeldung aus. Die
       Fehlererfassung sah dadurch sauberer aus, als die Anwendung war: Der
       sichtbarste Fehler war der einzige, der nirgends als Fehler gezaehlt
       wurde. Der Grund steht in `blockedReason` und wird mitgeschickt. */
    if (meta.mode === "blocked") {
      logClientError(new Error(data.blockedReason || "blocked.generic"), {
        phase: "analyse-blockiert",
        durationMs: timings.totalMs,
        requestId: String(myId),
        traceId,
        wakeLock: wakeLockStatus(),
      });
    }
    /* Ohne Vorgangskennung und ohne Geraeteangaben (26.09.2026, Begruendung
       in telemetry-logger.js). */
    logTelemetry("analyze-success", {
      durationMs: timings.totalMs,
      timings: { ...timings, renderMs: Date.now() - renderStart },
      meta: {
        subject: typeof meta.subject === "string" ? meta.subject : undefined,
        mode: typeof meta.mode === "string" ? meta.mode : undefined,
        lang: getLanguage(),
        queue: true,
      },
    });
  };

  /* v3.0.0: Erst den ungetippten Rest im Schnellvorlauf zu Ende tippen (ohne
     Live-Lauf löst das sofort auf), DANN rendern — sonst bricht das Tippen
     mitten im Wort ab und das Ergebnis springt hart ins Bild. */
  await liveAnzeige.schnellVorlauf();
  if (state.requestId !== myId) return;
  finishRender();
}

/* STRUCT-2026-10-03-54: Der EINE Ort, an dem ein Durchgang seine Flaggen
   zuruecksetzt. `analyzeImageQueued` und `resumeQueueJob` rufen ihn aus jedem
   Ausgang — die fruehen direkt vor ihrem `return`, alle uebrigen ueber den
   `finally`-Block. Bleibt an einem Ausgang eine Flagge stehen, nimmt die
   Seite kein Foto mehr an oder holt kein Ergebnis mehr ab, ohne Meldung;
   public/__tests__/analyse-ausgaenge.test.js haelt deshalb fest, dass hier
   und nur hier zurueckgesetzt wird.

   Nur der JUENGSTE Durchgang setzt zurueck: Ist er abgeloest, gehoeren die
   Flaggen schon dem Nachfolger.

   `wartetAufVerbindung` gehoert bewusst NICHT dazu: Der Anker muss das Ende
   des Durchgangs ueberleben (state.js); gesetzt und geloescht wird er dort,
   wo sich die Lage der Verbindung zeigt. */
function beendeAnalyse(myId) {
  if (state.requestId !== myId) return;
  state.isAnalyzing = false;
  state.uploadLaeuft = false;
  /* Der Bildschirm-Wachhalter gehoert dem juengsten Durchgang: Ein abgeloester
     gibt ihn nicht frei, sonst koennte das Geraet waehrend der Analyse des
     naechsten Fotos einschlafen. Frei gibt, wer als Letzter fertig wird — auf
     JEDEM Ausgang, auch den fruehen (Datei fehlt, Datei zu gross): Dort gab
     ihn sonst niemand frei, wenn der Durchgang davor abgeloest war. Ohne
     Wachhalter ist der Aufruf wirkungslos. */
  releaseWakeLock();
}

async function analyzeImageQueued() {
  state.isAnalyzing = true;
  /* v3.3.1: Ein neuer Anlauf loescht den Verbindungs-Anker. Scheitert er
     erneut an der Verbindung, setzt ihn der Fehlerpfad wieder — so bleibt
     der Anker immer die Lage von JETZT und nicht die von vorhin. */
  state.wartetAufVerbindung = false;
  /* Neues Foto, neuer Auftrag: Das Nachpruefen fuer den vorigen endet, und
     seine Obergrenze beginnt fuer den neuen von vorn. */
  verbindungsPruefungStoppen();
  wartetAufVerbindungSeit = 0;
  /* UX-001 (Audit 2026-08-10): Ab hier gehoert der Bildschirm dem NEUEN Foto.
     Die Job-Nummer des vorigen Durchgangs bleibt nach einem Erfolg bewusst
     stehen (damit ein Reload das Ergebnis wiederholen kann) — sie darf aber
     nicht mehr abgeholt werden, sobald ein neues Foto unterwegs ist. Ohne diese
     zwei Zeilen holte ein Tab-Wechsel waehrend des Uploads das ALTE Ergebnis
     und zeigte es neben dem NEUEN Foto; das neue Foto wurde nie hochgeladen.
     Was der Tab bis hierher gemerkt hatte, holt niemand mehr ab — also
     abmelden, gleich welcher Durchgang den Auftrag zuletzt fuehrte. */
  meldeOffenenAuftragAb();
  clearStoredJobId();
  state.uploadLaeuft = true;
  state.lastPollOk = Date.now();

  const myId = ++state.requestId;
  const analyzeStartTime = Date.now();
  const traceId = generateTraceId();
  state.lastTraceId = traceId;
  const timings = {};
  /* PRIV-2026-10-03-57: Der Abbruch-Schalter dieses Durchgangs. Solange der
     Upload laeuft, steht er in `state.currentAbortController`; die Wahl eines
     anderen Fotos (app.js, demo.js) loest ihn aus und beendet den Upload. */
  const abbruch = new AbortController();

  setStatus("");
  /* v3.0: Reste eines vorigen Live-Erlebnisses (Karte, Verdeckungen) räumen —
     dieser Durchgang beginnt sauber, gelaufen ist für ihn noch nichts. */
  liveAnzeige.zuruecksetzen();
  /* v3.1: Neues Foto = der Realitäts-Check des vorigen Ergebnisses ist
     hinfällig — Antworten, Sperre, Ergebnis und Karte vollständig zurück. */
  realitaetsCheck.zuruecksetzen();
  elements.facts.innerHTML = "";
  elements.privacy.innerHTML = "";
  elements.gpsMap.innerHTML = "";
  elements.targeting.innerHTML = "";
  elements.dataValue.innerHTML = "";
  elements.simulation.innerHTML = "";
  elements.exportPdf.classList.add("export-btn--hidden");

  /* Warte-Animation starten — Phase wird in showQueueWaiting weitergeschaltet:
     queued zeigt die Position, processing die gewohnten Analyse-Meldungen.
     FIX 1 (v3.0.1): Bis zur ersten Warteschlangen-Antwort steht der Upload-
     Hinweis statt eines leeren Texts — es darf ab der ersten Sekunde nie leer
     sein (der Foto-Upload dauert mehrere Sekunden). */
  resetQueueWaiting();
  startScanAnim(false);
  textSetzen(elements.scanText, t("scan.upload"));
  /* v3.0.3 Blick-Führung: Ab jetzt gehört der Blick diesem Lauf — die
     Übernahme-Wache startet EINMAL pro Analyse (ein eigener Scroll des
     Nutzers stoppt alle automatischen Bewegungen dauerhaft), und das Auge
     wird ins Bild geholt, falls es unter der Sichtkante liegt (am Handy
     sieht man sonst nur das Foto, aber nicht, dass etwas passiert). Die
     Wiederaufnahme nach einem Neuladen bleibt bewusst ohne Führung. */
  liveAnzeige.fuehrungStarten();
  liveAnzeige.augeInsBild();

  const file = state.lastFile || elements.fileInput.files[0];
  if (!file) {
    stopScanAnim(true);
    setStatus(t("error.noFile"), undefined, "error.noFile");
    meldeSichtbarenFehler("error.noFile", "datei-fehlt", { requestId: String(myId), traceId });
    beendeAnalyse(myId);
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    stopScanAnim(true);
    setStatus(t("error.fileTooLarge"), undefined, "error.fileTooLarge");
    meldeSichtbarenFehler("error.fileTooLarge", "datei-zu-gross", {
      requestId: String(myId),
      traceId,
      fileSizeKb: Math.round(file.size / 1024),
    });
    beendeAnalyse(myId);
    return;
  }
  /* Honeypot — Bots füllen unsichtbare Felder aus */
  const hp = document.getElementById("website");
  if (hp && hp.value) {
    stopScanAnim(true);
    beendeAnalyse(myId);
    return;
  }
  /* Mindest-Interaktionszeit — kein Mensch lädt in < 2s hoch */
  if (Date.now() - PAGE_LOADED_AT < MIN_INTERACTION_MS) {
    await sleep(MIN_INTERACTION_MS - (Date.now() - PAGE_LOADED_AT));
  }

  try {
    await acquireWakeLock();

    /* Bild komprimieren + EXIF extrahieren (client-seitig).
       BUG-2026-10-03-45: Das Ergebnis bleibt in einer eigenen Variable, bis
       feststeht, dass dieser Durchgang noch der juengste ist. Die Aufbereitung
       eines grossen Fotos dauert; waehlt jemand in der Zeit ein anderes, darf
       das ueberholte weder den gemeinsamen Zustand noch die Vorschau anfassen
       — sonst stuenden Ort und Aufnahmedatum des ersten Fotos im Ergebnis des
       zweiten. */
    const prepareStart = Date.now();
    let prepared = state.lastPrepared;
    if (!prepared) {
      prepared = await prepareImage(file, { auswahlZeit: state.auswahlZeit });
    }
    timings.prepareImageMs = Date.now() - prepareStart;
    if (state.requestId !== myId) return;
    state.lastPrepared = prepared;
    vorschauAusErgebnisFallsNoetig(prepared);

    /* Geocoding parallel starten wenn GPS vorhanden */
    if (prepared.gps) {
      startGeocoding(prepared.gps.latitude, prepared.gps.longitude);
    }

    /* ── Job einreihen ── */
    const enqueueStart = Date.now();
    state.currentAbortController = abbruch;
    const enqueueResp = await fetchWithTimeout(
      ENQUEUE_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: prepared.imageBase64,
          exif: prepared.exif,
          /* BUG-2026-08-19-01: Hier standen feste Werte. Der Canvas liefert
             nicht immer JPEG (siehe public/js/exif.js) — die feste Behauptung
             brachte am 19.08. zwei Uploads mit HTTP 400 zu Fall. Gemeldet wird
             jetzt, was tatsaechlich herauskam. */
          mimeType: prepared.mimeType || "image/jpeg",
          filename: prepared.dateiname || "upload.jpg",
          lang: getLanguage(),
          traceId,
        }),
      },
      ENQUEUE_TIMEOUT_MS,
      abbruch
    );
    timings.enqueueMs = Date.now() - enqueueStart;
    /* Der Upload ist durch — ab hier gibt es nichts mehr abzubrechen. */
    if (state.currentAbortController === abbruch) state.currentAbortController = null;
    if (state.requestId !== myId) {
      /* Abgeloest, aber der Server hat das Foto schon angenommen: Den Auftrag
         holt niemand mehr ab — abmelden statt ihn analysieren zu lassen. */
      if (enqueueResp.ok) {
        try {
          const verwaist = await enqueueResp.jsonMitTimeout();
          meldeAuftragAb(verwaist && verwaist.jobId, verwaist && verwaist.resultToken);
        } catch (_) {
          /* Antwort nicht lesbar — der Server raeumt nach seiner Karenz. */
        }
      }
      return;
    }

    if (!enqueueResp.ok) {
      stopScanAnim(true);
      let parsed = null;
      try {
        parsed = await enqueueResp.clone().json();
      } catch (_) {
        /* kein JSON-Body */
      }
      if (enqueueResp.status === 429 && parsed && parsed.blocked === "limit") {
        /* UX-2026-10-03-47: Nur der Limit-Hinweis, keine zweite Zeile. Er
           nennt Ursache und Wartezeit; „Zu viele Anfragen aus eurem Netzwerk.
           Wartet kurz …" daneben widersprach ihm. */
        showLimitBanner(parsed.retryAfterSeconds || 600);
      } else if (enqueueResp.status === 429 && parsed && parsed.blocked === "queueFull") {
        /* UX-2026-08-13-FE-02: Die volle Warteschlange ist im Workshop-Burst der
           ERWARTETE Fall, nicht ein Serverfehler. Vorher fiel er in den else-Zweig
           mit "Wir haben es dreimal probiert" — auf dem enqueue-Weg wird aber
           nichts wiederholt (ein einziger fetch). Eigener Text + die vom Server
           mitgelieferte Wartezeit. */
        setStatus(t("error.queueFull"), traceId, "error.queueFull");
      } else if (enqueueResp.status === 503 && parsed && parsed.maintenance) {
        showMaintenanceModal(parsed.message);
      } else if (enqueueResp.status === 503 && parsed && parsed.blocked === "configMissing") {
        /* BEFUND 01.09.2026 (Pruefrunde 8, N-P2-2): Dieser Fall fiel in den
           else-Zweig und zeigte "Die KI ist gerade ueberlastet — bitte 2-3
           Minuten warten". Die KI ist nicht ueberlastet, und Warten hilft
           nicht: Ohne gueltige Betriebseinstellungen kann keine Analyse
           laufen, egal wie lange jemand wartet. Der Text dafuer existiert
           seit jeher (blocked.configMissing, "das liegt nicht an dir und
           nicht an deinem Foto") und wurde am Einlass nie erreicht — der Weg
           dorthin ging nur ueber einen fertigen Job, also den seltenen Fall.

           Der falsche Rat ist der eigentliche Schaden: Eine Klasse, die drei
           Minuten wartet und es dann wieder versucht, verliert die
           Workshop-Zeit zweimal. */
        setStatus(t("blocked.configMissing"), traceId, "blocked.configMissing");
      } else if (enqueueResp.status === 413) {
        setStatus(t("error.imageTooLarge"), traceId, "error.imageTooLarge");
      } else if (enqueueResp.status === 400) {
        setStatus(t("error.invalidFormat"), traceId, "error.invalidFormat");
      } else if (enqueueResp.status === 429) {
        /* UX-2026-10-03-47: Jedes uebrige 429 ist die Sperre je
           Netzwerk-Adresse (der Server antwortet dort ohne das Merkmal
           `blocked`). Das ist der Fall „zu viele Anfragen aus eurem Netzwerk"
           — nicht „KI ueberlastet": Eine Klasse hinter einer gemeinsamen
           Schul-Adresse bekaeme sonst die falsche Ursache und den falschen
           Rat. */
        setStatus(t("error.rateLimit"), traceId, "error.rateLimit");
      } else {
        setStatus(t("error.serverBusy"), traceId, "error.serverBusy");
      }
      logClientError(new Error(`enqueue HTTP ${enqueueResp.status}`), {
        phase: "queue-enqueue",
        durationMs: Date.now() - analyzeStartTime,
        requestId: String(myId),
        traceId,
        httpStatus: enqueueResp.status,
        wakeLock: wakeLockStatus(),
      });
      return;
    }

    const enqueueData = await enqueueResp.jsonMitTimeout();
    const jobId = enqueueData && enqueueData.jobId;
    if (!jobId) {
      stopScanAnim(true);
      setStatus(t("error.queueFailed"), traceId, "error.queueFailed");
      meldeSichtbarenFehler("error.queueFailed", "einreihen-ohne-auftrag", {
        requestId: String(myId),
        traceId,
        httpStatus: enqueueResp.status,
        durationMs: Date.now() - analyzeStartTime,
      });
      return;
    }
    /* PRIV-003: Abhol-Ticket vom Server merken + bei jedem Poll mitschicken. */
    const resultToken = enqueueData.resultToken || null;
    /* Kam inzwischen ein anderes Foto, gehoert dieser Auftrag keinem mehr. */
    if (state.requestId !== myId) return void meldeAuftragAb(jobId, resultToken);
    storeJobId(jobId, resultToken);
    /* Ab hier gibt es wieder eine Job-Nummer, die zum aktuellen Foto gehoert —
       die Hintergrund-Wiederaufnahme darf also wieder uebernehmen. */
    state.uploadLaeuft = false;

    /* ── Auf das Ergebnis pollen (jeder Poll = Liveness-Herzschlag) ──
       liveErlaubt: nur hier, beim frischen Upload, darf die Live-Anzeige
       mittippen (v3.0) — die Wiederaufnahme unten bleibt beim heutigen Bild. */
    const outcome = await pollJob(jobId, myId, resultToken, false, true);
    /* Abgeloest waehrend des Wartens: Ein neues Foto hat den Auftrag beim
       Start seines Durchgangs abgemeldet; eine Wiederaufnahme fuehrt ihn weiter. */
    if (state.requestId !== myId) return;

    /* UX-2026-10-03-49: „Analyse abgeschlossen" wird nur angesagt, wenn ein
       Ergebnis da ist. Auf jedem Fehlerweg stoppt die Wartefigur leise — die
       Fehlermeldung traegt ihre Ansage selbst (`role="alert"`); davor
       „abgeschlossen" zu hoeren, waere falsch. */
    stopScanAnim(!(outcome && outcome.result));
    textSetzen(elements.scanText, "");

    if (!outcome) return;

    if (outcome.abandoned) {
      /* v3.0: nie halben Live-Text stehen lassen — Karte samt Text weg. */
      liveAbbrechenWegenFehler();
      clearStoredJobId();
      setStatus(t("error.queueAbandoned"), traceId, "error.queueAbandoned");
      meldeSichtbarenFehler("error.queueAbandoned", "auftrag-verworfen", {
        requestId: String(myId),
        traceId,
        durationMs: Date.now() - analyzeStartTime,
      });
      return;
    }
    if (outcome.error) {
      /* v3.3.1: Beim VERBINDUNGSABBRUCH bleibt der bereits geschriebene Text
         stehen (pausieren statt abbrechen). Er ist echt, er stammt vom Modell,
         und der Job läuft serverseitig weiter — ihn wegzuräumen sah nach
         Datenverlust aus, obwohl nichts verloren war. Bei jedem anderen Fehler
         (Job weg, fehlgeschlagen, 404) ist der Text gegenstandslos und wird
         wie bisher restlos abgeräumt. */
      if (outcome.transient) liveAnzeige.pausieren();
      else liveAbbrechenWegenFehler();
      /* Anker fuer die Wiederaufnahme — siehe state.js. */
      state.wartetAufVerbindung = Boolean(outcome.transient);
      if (outcome.transient) verbindungsPruefungStarten();
      /* Nur aufräumen, wenn der Job WIRKLICH weg ist (404, failed, abgelaufen).
         Bei einem Verbindungsabbruch bleibt die Nummer stehen: Sie ist der
         einzige Weg zurück zum fertigen Ergebnis — über die automatische
         Wiederaufnahme oder ein Neuladen der Seite. */
      if (!outcome.transient) clearStoredJobId();
      setStatus(t(outcome.error), traceId, outcome.error);
      logClientError(new Error(outcome.reason || "queue_failed"), {
        phase: "queue-poll",
        durationMs: Date.now() - analyzeStartTime,
        requestId: String(myId),
        traceId,
        wakeLock: wakeLockStatus(),
      });
      return;
    }

    /* Erfolg: jobId + Abhol-Ticket bewusst NICHT löschen. So holt ein Reload
       der Seite das Ergebnis erneut ab — es liegt serverseitig noch bis zu 2 h
       (PRIV-004) und ist durch das Ticket geschützt. Das ist der häufigste
       „Mein Profil ist nach dem Neuladen weg"-Fall. Überschrieben wird der
       Eintrag vom nächsten Upload; ist der Job serverseitig schon weg, räumt
       resumeQueueJob beim nächsten Seitenstart still auf. */
    timings.totalMs = Date.now() - analyzeStartTime;
    /* Das Ergebnis rendert direkt in die Dramaturgie hinein — nach dem
       Schnellvorlauf des restlichen Live-Texts (v3.0.0, daher await). */
    await renderQueueResult(outcome.result, myId, traceId, timings, prepared);
  } catch (err) {
    if (state.requestId !== myId) return;
    /* PRIV-2026-10-03-57: Der Upload wurde beendet, weil ein anderes Foto
       gewaehlt wurde. Das ist kein Fehler — keine Meldung, kein Eintrag in
       der Fehlererfassung; der Bildschirm gehoert schon der neuen Auswahl. */
    if (abbruch.signal.aborted) return;
    /* v3.0: auch beim harten Fehler keinen halben Live-Text stehen lassen. */
    liveAbbrechenWegenFehler();
    stopScanAnim(true);
    textSetzen(elements.scanText, "");

    let phase;
    if (err.message === "read_failed") {
      phase = "image-read";
      setStatus(t("error.readFailed"), traceId, "error.readFailed");
    } else if (err.message === "image_decode_failed") {
      phase = "image-decode";
      setStatus(t("error.decodeFailed"), traceId, "error.decodeFailed");
    } else if (!navigator.onLine) {
      phase = "offline";
      setStatus(t("error.offline"), traceId, "error.offline");
    } else {
      phase = "queue-network";
      setStatus(t("error.networkError"), traceId, "error.networkError");
    }
    logClientError(err, {
      phase,
      durationMs: Date.now() - analyzeStartTime,
      requestId: String(myId),
      traceId,
      wakeLock: wakeLockStatus(),
      fileFormat: err.fileFormat,
      errorDetail: err.errorDetail,
      fileSizeKb: err.fileSizeKb,
      /* Lesefehler-Diagnose (08.09.2026): Zeit seit der Auswahl und das
         Ergebnis des zweiten Lesewegs — beides ohne Personenbezug. */
      msSeitAuswahl: err.msSeitAuswahl,
      zweiterLeseweg: err.zweiterLeseweg,
      kopfLesetest: err.kopfLesetest,
    });
  } finally {
    /* Der Schalter gilt nur, solange dieser Durchgang hochlaedt. */
    if (state.currentAbortController === abbruch) state.currentAbortController = null;
    beendeAnalyse(myId);
  }
}

/**
 * Holt nach einem Seiten-Neuladen ein noch offenes Queue-Ergebnis ab: Liegt
 * eine jobId aus einem früheren Seitenbesuch in sessionStorage, wird das
 * Polling fortgesetzt und das Ergebnis angezeigt. Das eliminiert die
 * „Geister-Durchläufe" — der User bekommt sein Profil auch dann, wenn er die
 * Seite versehentlich neu geladen oder kurz verlassen hat. Wird beim
 * Seitenstart aufgerufen; ohne offene jobId ein No-Op.
 */
export async function resumeQueueJob({ force = false } = {}) {
  const jobId = getStoredJobId();
  if (!jobId) return;
  /* PRIV-107: Ein bereits zugestelltes Ergebnis ist nur 15 Minuten lang per
     Reload wiederholbar. Danach still aufräumen — das Gerät gilt als
     weitergereicht, die nächste Person startet sauber. */
  if (ergebnisFristAbgelaufen()) {
    clearStoredJobId();
    return;
  }
  /* Normalerweise nicht dazwischenfunken, wenn gerade eine Analyse laeuft.
     force=true kommt von der Hintergrund-Wiederaufnahme: Dort ist der laufende
     Durchgang nachweislich stehengeblieben, und ein neuer Anlauf ist der Sinn
     der Sache. Das ++state.requestId unten beendet den alten sauber. */
  if (state.isAnalyzing && !force) return;
  /* PRIV-003: das gespeicherte Abhol-Ticket mitnehmen (überlebt den Reload). */
  const resultToken = getStoredResultToken();

  state.isAnalyzing = true;
  /* Stand bis eben die Zusage „erscheint automatisch" auf dem Bildschirm? */
  const nachAbriss = state.wartetAufVerbindung;
  /* v3.3.1: Ein neuer Anlauf loescht den Verbindungs-Anker. Scheitert er
     erneut an der Verbindung, setzt ihn der Fehlerpfad wieder — so bleibt
     der Anker immer die Lage von JETZT und nicht die von vorhin. */
  state.wartetAufVerbindung = false;
  /* Solange dieser Anlauf laeuft, fragt er selbst — das Nachpruefen ruht. */
  verbindungsPruefungStoppen();
  const myId = ++state.requestId;
  const traceId = generateTraceId();
  const startTime = Date.now();

  /* state.lastPrepared ist nach einem Reload leer — GPS kann nicht mehr
     injiziert werden (verlässt den Browser ohnehin nie). Das Profil selbst
     liegt vollständig serverseitig. */
  /* v3.3.1: ZWEI Wiederaufnahmen, die sich grundlegend unterscheiden.

     (a) Ein pausierter Live-Lauf steht noch im Fenster — der Verbindungs-
         abbruch hat ihn angehalten, nicht zerstoert. Puffer und Tipp-Stand
         sind unberuehrt. Hier wird NICHTS zurueckgesetzt: Der Text bleibt
         genau stehen, wie der Nutzer ihn zuletzt gesehen hat, und die Schleife
         tippt an derselben Stelle weiter. Genau das ist die Zusage hinter
         „erscheint automatisch, sobald du wieder online bist" — sie war bis
         v3.3.0 nicht gedeckt, weil hier zurueckgesetzt und ohne Live-Text
         weitergefragt wurde.

     (b) Nach einem Neuladen ist der Lauf weg (der Speicher ist leer). Dann
         bleibt es beim bisherigen Verhalten: Scan-Animation bis zum fertigen
         Ergebnis. Halben Text aus dem Nichts nachzubauen waere Theater. */
  const setztLiveTextFort = liveAnzeige.istPausiert();

  if (setztLiveTextFort) {
    liveAnzeige.fortsetzen();
    setStatus("");
    /* UX-2026-10-03-49: Riss die Verbindung ab, bevor das erste Zeichen
       getippt war (der Anlauf dauert, oder fuer die gewaehlte Profil-Art
       liegt noch kein Text vor), steht nach dem Fortsetzen nichts auf dem
       Bildschirm: keine Live-Karte, keine Wartefigur, keine Meldung — obwohl
       die Analyse laeuft. Dann zeigt die Wartefigur, dass etwas geschieht;
       das erste getippte Zeichen blendet sie wie gewohnt aus. Leise: Das ist
       kein neuer Analyse-Start. */
    if (!elements.liveKarte || !elements.liveKarte.classList.contains("active")) {
      startScanAnim(false, true);
      textSetzen(elements.scanText, t("scan.resume"));
    }
  } else {
    liveAnzeige.zuruecksetzen();
    /* BUG-2026-10-03-45: Ohne pausierten Lauf fragt die Wiederaufnahme ohne
       Live-Text weiter — die Merkmal-Karten fuellen sich bis zum Ergebnis
       nicht mehr. Halb gefuellte Karten neben der Wartefigur saehen aus wie
       ein haengender Lauf; das fertige Ergebnis baut sie vollstaendig neu. */
    if (elements.facts) elements.facts.innerHTML = "";
    /* BUG-2026-10-03-46: Auch hier die Statuszeile leeren — sonst steht
       „Verbindung unterbrochen" neben der Wartefigur, die gerade abholt. */
    setStatus("");
    resetQueueWaiting();
    startScanAnim(false);
    /* FIX 1 (v3.0.1): Auch die Wiederaufnahme startet nie mit leerem Text. */
    textSetzen(elements.scanText, t("scan.resume"));
  }

  try {
    /* pollImmediately=true: das fertige Ergebnis sofort holen, ohne 2s-Vorlauf.
       liveErlaubt nur im Fall (a): Nur dort gibt es einen Puffer, an den die
       naechste Welle anschliessen kann. */
    const outcome = await pollJob(jobId, myId, resultToken, true, setztLiveTextFort);
    if (state.requestId !== myId) return;

    /* Wie oben: die Abschluss-Ansage nur mit Ergebnis. */
    stopScanAnim(!(outcome && outcome.result));
    textSetzen(elements.scanText, "");

    /* BUG-2026-08-17-03: Ein ABGERISSENER Versuch darf die Job-Nummer nicht
       wegwerfen. Sie ist der einzige Weg zurueck zu einem Ergebnis, das
       serverseitig rund zwei Stunden bereitliegt. Bis v3.3.0 raeumte die
       Wiederaufnahme bei JEDEM Fehler auf — solange sie nur beim Seitenstart
       lief, blieb das folgenlos. Seit sie auch bei „wieder online" mitten im
       Lauf greift, wuerde ein zweiter Abbruch das fertige Profil endgueltig
       unerreichbar machen. Also: erneut pausieren, Nummer behalten. */
    if (outcome && outcome.error && outcome.transient) {
      if (!liveAnzeige.pausieren()) startScanAnim(false);
      state.wartetAufVerbindung = true;
      verbindungsPruefungStarten();
      setStatus(t(outcome.error), traceId, outcome.error);
      meldeSichtbarenFehler("error.connectionLost", "resume-verbindung", { requestId: String(myId), traceId });
      return;
    }

    /* Resume ist eine stille Hintergrund-Wiederherstellung beim Seitenstart.
       Ist der Job weg oder fehlgeschlagen (abgelaufen / abgebrochen / nach 2 h
       serverseitig gelöscht → 404), den User NICHT mit einer Fehlermeldung
       erschrecken: still aufräumen und die normale Startseite zeigen. */
    if (!outcome || outcome.abandoned || outcome.error) {
      liveAbbrechenWegenFehler();
      clearStoredJobId();
      /* ANDERS nach einem Verbindungsabriss mitten im Lauf: Dort stand eben
         noch „deine Analyse laeuft weiter — sie erscheint automatisch". Ist
         der Auftrag inzwischen gescheitert oder verworfen, bekommt das Kind
         eine Antwort statt einer leeren Zeile, und die Fehlererfassung auch. */
      const schluessel =
        outcome && outcome.abandoned ? "error.queueAbandoned" : (outcome && outcome.error) || "error.queueFailed";
      setStatus(nachAbriss ? t(schluessel) : "", nachAbriss ? traceId : undefined, nachAbriss ? schluessel : undefined);
      if (nachAbriss) meldeSichtbarenFehler(schluessel, "resume-nach-abriss", { requestId: String(myId), traceId });
      return;
    }
    /* Erfolg: Ticket behalten, damit auch ein weiterer Reload das Ergebnis
       wieder zeigt (bis zum nächsten Upload oder bis der Job serverseitig
       abläuft). */
    /* Foto ist nach einem Reload weg (Datenschutz, s. showPhotoDeletedNotice) →
       an seine Stelle den positiven Datenschutz-Hinweis setzen.

       ABER NUR DANN. Bei der Wiederaufnahme aus dem Hintergrund lief die Seite
       durchgehend, das Foto steht also noch im Fenster — es hier zu entfernen
       wäre ein unnötiger Verlust: Der Nutzer hat sein Bild gerade eben selbst
       ausgewählt und will es neben dem Ergebnis sehen. Datenschutzrechtlich
       ändert das nichts, denn gespeichert wird nach wie vor nirgends etwas;
       es wird nur nicht weggeworfen, was ohnehin schon angezeigt wird. */
    if (!elements.imagePreview?.querySelector("img")) showPhotoDeletedNotice();
    /* Die Wiederaufnahme hat keine eigene Aufbereitung. Lief die Seite durch,
       steht die des Fotos noch im Zustand; nach einem Neuladen ist er leer. */
    await renderQueueResult(outcome.result, myId, traceId, { totalMs: Date.now() - startTime }, state.lastPrepared);
  } catch (err) {
    if (state.requestId !== myId) return;
    clearStoredJobId();
    stopScanAnim(true);
    textSetzen(elements.scanText, "");
    setStatus(""); /* stiller Fehler beim Seitenstart — kein Banner */
    logClientError(err, { phase: "queue-resume", requestId: String(myId), traceId });
  } finally {
    /* Gibt auch den Bildschirm-Wachhalter frei, wenn diese Wiederaufnahme der
       juengste Durchgang ist (beendeAnalyse). */
    beendeAnalyse(myId);
  }
}
