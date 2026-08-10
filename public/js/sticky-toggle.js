/* Sticky-Umschalter (Seriöse Analyse ↔ Beast Mode).
 *
 * Sobald ein Ergebnis vorliegt, bleibt der Umschalter beim Scrollen oben
 * stehen (Positionswechsel per CSS, siehe styles.css: html[data-has-result]).
 * Hier liegt nur das, was CSS nicht kann: den geklebten Zustand erkennen und
 * beim Moduswechsel die Leseposition halten.
 *
 * Bewusst KEIN zweites Bedienelement — derselbe Schalter wechselt nur seine
 * Position. Ein Duplikat unten wäre ein zweiter Tab-Stopp und müsste die
 * fixed positionierten Tooltips erneut ausrichten.
 */

import { elements } from "./dom.js";

/* Wie viele Pixel eine Karte unter der Leiste hervorschauen muss, damit sie
   als „gerade gelesen" gilt und nicht die schon halb verdeckte darüber. */
const ANCHOR_TOLERANCE_PX = 4;

/* ── Geklebt-Zustand ──────────────────────────────────────────────────────
   Eine nullhohe Marke direkt über der Leiste. Kreuzt sie den oberen Rand,
   klebt die Leiste. Per IntersectionObserver statt scroll-Listener, damit
   beim Scrollen kein Layout-Zwang pro Frame entsteht (Workshop-Handys). */
export function initStickyToggle() {
  const wrap = elements.biasToggleWrap;
  if (!wrap || !wrap.parentNode || typeof IntersectionObserver !== "function") return null;

  const sentinel = document.createElement("div");
  sentinel.className = "bias-sticky-sentinel";
  sentinel.setAttribute("aria-hidden", "true");
  wrap.parentNode.insertBefore(sentinel, wrap);

  const observer = new IntersectionObserver(
    ([entry]) => {
      wrap.classList.toggle("is-stuck", !entry.isIntersecting);
    },
    { threshold: 0 }
  );
  observer.observe(sentinel);
  return observer;
}

/* ── Leseposition über den Moduswechsel retten ────────────────────────────
   Beast-Texte sind länger als die sachlichen (Profiltext ~150 statt ~100
   Wörter, jede Karte etwas anders). Ohne Ausgleich wächst der Inhalt beim
   Umschalten und die gerade gelesene Karte rutscht unter dem Finger weg —
   genau die Stelle, die man vergleichen wollte.

   Deshalb: oberste sichtbare Karte merken, nach dem Neuaufbau dieselbe Karte
   (über data-key) wieder auf dieselbe Bildschirmhöhe holen. */
export function renderKeepingScrollAnchor(render) {
  const anchor = findAnchorCard();
  const topBefore = anchor ? anchor.getBoundingClientRect().top : null;
  const anchorKey = anchor ? anchor.dataset.key : null;

  /* Waehrend des Neuaufbaus (innerHTML) ist die Seite kurzzeitig kuerzer. Der
     Browser klemmt die Scrollposition dann ans neue Seitenende, danach waechst
     der Inhalt wieder — die Anker-Rechnung stuende auf verschobenem Grund.
     Deshalb die Hoehe fuer die Dauer des Renderns festhalten: schrumpft
     nichts, klemmt nichts. */
  const panel = elements.resultsPanel;
  const lockedHeight = panel ? panel.offsetHeight : 0;
  if (panel && lockedHeight > 0) panel.style.minHeight = lockedHeight + "px";

  try {
    render();
  } finally {
    /* Der Kartenbereich wird per innerHTML neu aufgebaut — die alte Referenz
       ist tot, die Karte deshalb über ihren Schlüssel neu suchen. */
    if (anchorKey && topBefore !== null) scrollAnchorTo(anchorKey, topBefore);
    /* Erst NACH der Korrektur freigeben, sonst schrumpft die Seite doch noch
       und klemmt die gerade gesetzte Position wieder weg. */
    if (panel && lockedHeight > 0) panel.style.minHeight = "";
  }

  if (!anchorKey || topBefore === null) return;

  /* Nach der Freigabe kann die Seite kuerzer sein als vorher (Beast → sachlich).
     Dann hat der Browser erneut geklemmt — im Folgeframe nachfassen. */
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => scrollAnchorTo(anchorKey, topBefore));
  }
}

/* Die Karte mit diesem Schluessel wieder auf die Bildschirmhoehe topTarget
   holen. Bewusst ABSOLUT (scrollTo) statt relativ (scrollBy): zwischen Messung
   und Korrektur kann sich die Scrollposition selbst veraendert haben, ein
   Delta rechnet dann auf einem veralteten Stand. */
function scrollAnchorTo(anchorKey, topTarget) {
  const card = cards().find((c) => c.dataset.key === anchorKey);
  if (!card) return;

  const scrollY = typeof window.scrollY === "number" ? window.scrollY : 0;
  const docTop = card.getBoundingClientRect().top + scrollY;
  const target = Math.max(0, docTop - topTarget);

  if (Math.abs(target - scrollY) < 1) return;
  /* Hart springen, nicht animieren: die Korrektur soll unsichtbar sein. */
  if (typeof window.scrollTo === "function") {
    window.scrollTo({ top: target, behavior: "instant" });
  }
}

function cards() {
  return Array.from(document.querySelectorAll("#facts .cat-card"));
}

/* Erste Karte, die nicht schon hinter der geklebten Leiste verschwunden ist. */
function findAnchorCard() {
  const wrap = elements.biasToggleWrap;
  const barBottom = wrap ? wrap.getBoundingClientRect().bottom : 0;
  const sichtbareHoehe = typeof window.innerHeight === "number" ? window.innerHeight : 0;

  /* Zwei Bedingungen, beide nötig:
       1. Die Karte schaut unter der geklebten Leiste hervor (nicht verdeckt).
       2. Sie beginnt INNERHALB des Bildschirms.

     Ohne die zweite Bedingung griff der Anker auch dann, wenn man ganz oben
     bei der Überschrift steht — die erste Karte liegt ja irgendwo weiter unten
     und erfüllt Bedingung 1 trivial. Beim Umschalten wurde dann dorthin
     gescrollt und die Überschrift verschwand. Steht keine Karte im Bild, ist
     man nicht in der Kartenliste und es gibt nichts zu verankern. */
  return (
    cards().find((c) => {
      const r = c.getBoundingClientRect();
      return r.bottom > barBottom + ANCHOR_TOLERANCE_PX && r.top < sichtbareHoehe;
    }) || null
  );
}
