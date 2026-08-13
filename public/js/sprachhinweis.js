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
 * Das bleibt so: Ob der Umschalter erscheint, entscheidet allein die Adresse
 * (`?sprachumschalter=1`) oder eine Spur, die die Startseite im selben Tab
 * hinterlassen hat. Kein Netzweg, kein Merkmals-Abruf auf einer Rechtsseite.
 */

const TUER = "malzime-tuer-sprachumschalter";
const MERKMAL = "malzime-umschalter-aktiv";
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

/* Dieselbe Tür wie auf der Startseite (js/sprachumschalter.js). Sie liegt im
   localStorage, weil diese Seiten mit target="_blank" rel="noopener" geöffnet
   werden: Ein so geöffneter Tab bekommt einen leeren sessionStorage, eine
   Spur von dort wäre hier nie angekommen. */
function sichtbar() {
  let wert = null;
  try {
    wert = new URLSearchParams(window.location.search).get("sprachumschalter");
  } catch (_err) {
    /* kaputte Adresse */
  }
  try {
    if (wert === "1") localStorage.setItem(TUER, "1");
    if (wert === "0") localStorage.removeItem(TUER);
    return localStorage.getItem(TUER) === "1" || localStorage.getItem(MERKMAL) === "1";
  } catch (_err) {
    /* Privater Modus: dann gilt nur die Angabe in der Adresse. */
    return wert === "1";
  }
}

function knopf(code, aktiv) {
  const b = document.createElement("button");
  b.type = "button";
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

  const titelEn = document.createElement("h2");
  titelEn.className = "sw-zweitsprache";
  titelEn.lang = "en";
  titelEn.textContent = TEXTE.titel_en;

  const knoepfe = document.createElement("div");
  knoepfe.className = "sw-knoepfe";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "sw-knopf sw-knopf--bleiben";
  ok.textContent = TEXTE.knopf;
  knoepfe.appendChild(ok);

  kasten.append(schliessen, titel, titelEn, knoepfe);
  grund.appendChild(kasten);

  return { grund, ok, schliessen };
}

function start() {
  if (!sichtbar()) return;

  const ziel = document.getElementById("main") || document.querySelector("main") || document.body;
  const { grund, ok, schliessen } = baueHinweis();
  let ausloeser = null;

  function stillegen(an) {
    Array.prototype.forEach.call(document.body.children, (kind) => {
      if (kind === grund) return;
      if (an) kind.setAttribute("inert", "");
      else kind.removeAttribute("inert");
    });
  }

  function oeffnen() {
    ausloeser = document.activeElement;
    grund.hidden = false;
    stillegen(true);
    const dieser = grund;
    requestAnimationFrame(() => dieser.classList.add("sichtbar"));
    ok.focus();
  }

  function schliessenTun() {
    if (grund.hidden) return;
    stillegen(false);
    grund.classList.remove("sichtbar");
    setTimeout(() => {
      grund.hidden = true;
    }, 200);
    if (ausloeser && typeof ausloeser.focus === "function") ausloeser.focus();
    ausloeser = null;
  }

  const umschalter = baueUmschalter(oeffnen);
  ziel.insertBefore(umschalter, ziel.firstChild);
  document.body.appendChild(grund);

  ok.addEventListener("click", schliessenTun);
  schliessen.addEventListener("click", schliessenTun);
  grund.addEventListener("click", (e) => {
    if (e.target === grund) schliessenTun();
  });

  /* Fokus-Fänger: `inert` hält ihn aus der Umgebung heraus, aber hinter dem
     letzten Knopf verließe er das Dokument in die Browserleiste. */
  document.addEventListener("keydown", (e) => {
    if (grund.hidden) return;
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
