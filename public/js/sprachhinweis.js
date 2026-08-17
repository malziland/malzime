/* ── Sprachumschalter auf den noch nicht übersetzten Seiten ────────────────
 *
 * ÜBERGANGSLÖSUNG. Sie verschwindet vollständig, sobald Datenschutzerklärung,
 * Impressum und Nutzungsbedingungen auf Englisch vorliegen: dann bekommen
 * diese Seiten den echten Umschalter aus js/sprachumschalter.js, und diese
 * Datei samt ihrer beiden Zeilen im HTML wird gelöscht.
 *
 * Warum es sie überhaupt gibt: Der Umschalter gehört auf JEDE Seite. Fehlte er
 * hier, sähe es aus wie ein Fehler — man käme von der englischen Startseite und
 * hätte plötzlich kein Bedienelement mehr.
 *
 * Zwei bewusste Festlegungen:
 *
 * 1. Der Schalter steht hier IMMER auf DE, auch bei englischem Browser und
 *    auch, wenn im Tab vorher Englisch gewählt wurde. Er sagt aus, in welcher
 *    Sprache das dasteht, was man gerade liest — und das ist Deutsch. EN
 *    anzuzeigen wäre schlicht falsch.
 *
 * 2. Der Hinweis ist ZWEISPRACHIG. Wer auf EN klickt, liest kein Deutsch; eine
 *    rein deutsche Erklärung wäre genau die falsche. Zwei kurze Zeilen
 *    untereinander sind auch deshalb richtig, weil so keine Sprachlogik
 *    entsteht, die später zurückgebaut werden müsste.
 *
 * Diese Seiten laden sonst KEIN JavaScript und rufen keine Schnittstelle auf.
 * Das bleibt so: kein Netzweg, kein Merkmals-Abruf auf einer Rechtsseite.
 *
 * v3.3.1 — die Erprobungs-Tür ist weg, und mit ihr der localStorage.
 * Bis v3.3.0 entschied hier eine Spur im localStorage (`malzime-tuer-…`,
 * `malzime-umschalter-aktiv`), ob der Umschalter erscheint. Sie stammte aus der
 * Zeit vor der Freischaltung, als er sich vorführen lassen musste, ohne dass
 * ein Workshop-Publikum ihn sieht. Zwei Gründe, warum sie jetzt fort ist:
 *
 *   1. Die Datenschutzerklärung sagt zu, im Browser nichts Dauerhaftes
 *      abzulegen. Der Eintrag entstand bei JEDEM Besucher und widersprach ihr.
 *      Der Rechtstext ist die Vorgabe, nicht der Code.
 *   2. Der Umschalter ist seit v3.3.0 live. Eine Tür, die an einem
 *      freigeschalteten Zimmer vorbeiführt, braucht niemand mehr.
 *
 * Der Umschalter erscheint hier deshalb schlicht immer — so lange, bis diese
 * Übergangsdatei samt den Rechtstexten auf Englisch verschwindet.
 */

const KREUZ_ZEICHEN = "×";

/* Je EIN Satz pro Sprache. Alles darüber hinaus liest im Workshop niemand
   (Nutzer-Ansage 2026-08-13). */
const TEXTE = {
  titel_de: "Diese Seite gibt es nur auf Deutsch.",
  titel_en: "This page is German only.",
  knopf: "OK",
  schliessen_de: "Schließen",
  schliessen_en: "Close",
};

/* Wohin der Umschalter gehört, je nach Seitenaufbau:

   - Startseite: in die Kopfzeile mit dem SYSTEM-AKTIV-Abzeichen (`.hero`).
   - Unterseiten: auf dieselbe Zeile wie die Rubrik oben („malziME · Statistik",
     „malziME · Rechtliches"). Dafür kommen Rubrik und Umschalter in eine
     gemeinsame Zeile — vorher stand er darüber, was nach einem losen Element
     aussah statt nach einer Kopfzeile (Nutzer-Ansage 2026-08-13).
   - Sonst: an den Anfang des Inhalts. */
function umschalterEinsetzen(el) {
  /* Die Rubrik zuerst: Sie ist, wo vorhanden, die oberste Zeile — auch auf der
     Zahlen-Seite, die zusaetzlich einen Hero-Block hat. Erst wenn es keine
     gibt (Startseite), kommt die Kopfzeile mit dem Abzeichen. */
  const rubrik = document.querySelector(".page-eyebrow");
  if (rubrik && rubrik.parentNode) {
    const zeile = document.createElement("div");
    zeile.className = "seiten-kopfzeile";
    rubrik.parentNode.insertBefore(zeile, rubrik);
    zeile.append(rubrik, el);
    return true;
  }
  const hero = document.querySelector(".hero");
  if (hero) {
    hero.insertBefore(el, hero.firstChild);
    return true;
  }
  const main = document.getElementById("main");
  if (!main) return false;
  main.insertBefore(el, main.firstChild);
  return true;
}

function knopf(code, aktiv) {
  const b = document.createElement("button");
  b.type = "button";
  /* SAFARI-REGEL (BUG-2026-08-17-08): Safari tabbt ohne „Vollzugriff Tastatur"
     NICHT zu Buttons — jedes Bedienelement braucht ein ausdrueckliches
     tabindex="0". Fuer die statische index.html erzwingt das ein Unit-Test seit
     Langem; die HIER im JavaScript erzeugten Knoepfe hat er nie gesehen. Folge:
     Der Sprachumschalter war auf Safari mit der Tastatur nicht erreichbar —
     WCAG 2.1.1, Stufe A. Gefunden von einem Nutzer auf der Live-Seite, nicht
     von einem Test. */
  b.setAttribute("tabindex", "0");
  b.className = "sprach-knopf" + (aktiv ? " aktiv" : "");
  b.dataset.lang = code;
  b.textContent = code.toUpperCase();
  b.lang = code;
  b.setAttribute("aria-pressed", String(aktiv));
  b.setAttribute("aria-label", code === "de" ? "Deutsch" : "English");
  return b;
}

function baueUmschalter(beiKlick) {
  const huelle = document.createElement("div");
  huelle.className = "sprachwahl";

  const pille = document.createElement("div");
  pille.className = "sprach-pille";
  pille.setAttribute("role", "group");
  pille.setAttribute("aria-label", "Sprache wählen / Choose language");

  const schieber = document.createElement("span");
  schieber.className = "sprach-schieber";
  schieber.setAttribute("aria-hidden", "true");
  pille.appendChild(schieber);

  /* DE ist hier immer der aktive Stand — siehe Festlegung 1 oben. */
  pille.appendChild(knopf("de", true));
  const en = knopf("en", false);
  en.addEventListener("click", beiKlick);
  pille.appendChild(en);

  huelle.appendChild(pille);
  return huelle;
}

function baueHinweis() {
  const grund = document.createElement("div");
  grund.className = "sw-grund";
  grund.dataset.modal = "unuebersetzt";
  grund.hidden = true;

  const kasten = document.createElement("div");
  kasten.className = "sw-modal";
  kasten.setAttribute("role", "dialog");
  kasten.setAttribute("aria-modal", "true");

  const schliessen = document.createElement("button");
  schliessen.type = "button";
  schliessen.setAttribute("tabindex", "0");
  schliessen.className = "sw-schliessen";
  schliessen.setAttribute("aria-label", `${TEXTE.schliessen_de} / ${TEXTE.schliessen_en}`);
  const kreuz = document.createElement("span");
  kreuz.setAttribute("aria-hidden", "true");
  kreuz.textContent = KREUZ_ZEICHEN;
  schliessen.appendChild(kreuz);

  const titel = document.createElement("h2");
  titel.id = "sw-titel-unuebersetzt";
  titel.lang = "de";
  titel.textContent = TEXTE.titel_de;
  kasten.setAttribute("aria-labelledby", titel.id);

  /* Die englische Zeile ist die Übersetzung, nicht eine zweite Überschrift.
     Als <h2> in gleicher Grösse und Fettung sahen beide aus, als stritten sie
     um den Rang — und ein Dialog hat genau EINE Überschrift. Jetzt ein
     zurückgenommener Absatz darunter. */
  const titelEn = document.createElement("p");
  titelEn.className = "sw-zweitsprache";
  titelEn.lang = "en";
  titelEn.textContent = TEXTE.titel_en;

  const knoepfe = document.createElement("div");
  knoepfe.className = "sw-knoepfe";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.setAttribute("tabindex", "0");
  ok.className = "sw-knopf sw-knopf--bleiben";
  ok.textContent = TEXTE.knopf;
  knoepfe.appendChild(ok);

  kasten.append(schliessen, titel, titelEn, knoepfe);
  grund.appendChild(kasten);

  return { grund, ok, schliessen };
}

function start() {
  const { grund, ok, schliessen } = baueHinweis();
  let ausloeser = null;
  /* Eigener Zustand statt `grund.hidden`: Das Verbergen passiert erst nach dem
     Ausblenden (200 ms). In dieser Lücke feuerte ein noch offener Zeitgeber des
     Fokus-Netzes und zog den Fokus in den schliessenden Dialog zurück — der
     Rücksprung auf den Umschalter fiel damit aus. In der CI aufgeschlagen,
     lokal nie. */
  let offen = false;

  function stillegen(an) {
    Array.prototype.forEach.call(document.body.children, (kind) => {
      if (kind === grund) return;
      if (an) kind.setAttribute("inert", "");
      else kind.removeAttribute("inert");
    });
  }

  /* Letztes Netz, wie beim echten Umschalter: In Safari tabbt man ohne
     „Vollzugriff Tastatur" nicht auf Knöpfe — der Fokus landet dann im Nichts
     und kommt nicht zurück. Am 2026-08-13 im WebKit-Lauf gemessen. */
  function fokusZurueckholen() {
    setTimeout(() => {
      if (!offen || grund.contains(document.activeElement)) return;
      const erster = grund.querySelector("button");
      if (erster) erster.focus();
    }, 0);
  }

  function oeffnen(e) {
    /* Den auslösenden Knopf merken, nicht document.activeElement — in WebKit
       fokussiert ein Klick den Knopf nicht. */
    ausloeser = (e && e.currentTarget) || document.activeElement;
    offen = true;
    grund.hidden = false;
    stillegen(true);
    const dieser = grund;
    requestAnimationFrame(() => dieser.classList.add("sichtbar"));
    grund.addEventListener("focusout", fokusZurueckholen);
    ok.focus();
  }

  function schliessenTun() {
    if (!offen) return;
    offen = false;
    grund.removeEventListener("focusout", fokusZurueckholen);
    stillegen(false);
    grund.classList.remove("sichtbar");
    setTimeout(() => {
      grund.hidden = true;
    }, 200);
    if (ausloeser && typeof ausloeser.focus === "function") ausloeser.focus();
    ausloeser = null;
  }

  const umschalter = baueUmschalter(oeffnen);
  if (!umschalterEinsetzen(umschalter)) return;
  document.body.appendChild(grund);

  ok.addEventListener("click", schliessenTun);
  schliessen.addEventListener("click", schliessenTun);
  grund.addEventListener("click", (e) => {
    if (e.target === grund) schliessenTun();
  });

  /* Fokus-Fänger: `inert` hält ihn aus der Umgebung heraus, aber hinter dem
     letzten Knopf verließe er das Dokument in die Browserleiste. */
  document.addEventListener("keydown", (e) => {
    if (!offen) return;
    if (e.key === "Escape") {
      schliessenTun();
      return;
    }
    if (e.key !== "Tab") return;
    const ziele = Array.from(grund.querySelectorAll("button"));
    const erster = ziele[0];
    const letzter = ziele[ziele.length - 1];
    if (e.shiftKey && document.activeElement === erster) {
      e.preventDefault();
      letzter.focus();
    } else if (!e.shiftKey && document.activeElement === letzter) {
      e.preventDefault();
      erster.focus();
    }
  });
}

start();
