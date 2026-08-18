/**
 * echtheit-pruefen.js — rechnet den ausgelieferten Stand im Browser nach.
 *
 * Holt /build-info.json, laedt jede dort genannte Datei von dieser Website und
 * rechnet ihre SHA-256-Pruefsumme neu aus. Alles im Browser, ohne Server,
 * ohne fremde Bibliothek: `crypto.subtle` kann jeder moderne Browser.
 *
 * ZUR OFFENHEIT, und das gehoert offen gesagt: Diese Datei liegt selbst in
 * public/js/ und steht damit selbst im Fingerabdruck. Sie prueft sich also
 * mit — wenn jemand sie austauschen wuerde, faellt es in ihrer eigenen Zeile
 * auf. Was sie NICHT leisten kann: Wer diese Website vollstaendig unter
 * Kontrolle haette, koennte auch ein luegendes Pruefprogramm ausliefern. Genau
 * deshalb steht der Weg ueber die Kommandozeile daneben — der laeuft aus einem
 * frischen Klon des Repositories und ist von dieser Seite unabhaengig.
 *
 * ZUR BARRIEREFREIHEIT: Die Zeilen laufen bewusst NICHT durch einen
 * aria-live-Bereich. Achtzig Ansagen in Folge sind fuer einen Screenreader
 * unbenutzbar — das war am 17.08. ein echter Befund. Angesagt wird nur das
 * Ergebnis, einmal.
 */

const ZIEL = "/build-info.json";
const GLEICHZEITIG = 6;

/** Wandelt einen Puffer in die Hex-Schreibweise, wie sie im Fingerabdruck steht. */
async function summeVon(puffer) {
  const roh = await window.crypto.subtle.digest("SHA-256", puffer);
  return (
    "sha256:" +
    Array.from(new Uint8Array(roh))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function initEchtheitspruefung() {
  const knopf = document.getElementById("echtheitKnopf");
  const konsole = document.getElementById("echtheitKonsole");
  const zeilen = document.getElementById("echtheitZeilen");
  const ergebnis = document.getElementById("echtheitErgebnis");
  if (!knopf || !konsole || !zeilen || !ergebnis) return;

  /* Ohne SubtleCrypto geht es nicht — das ehrlich sagen statt still scheitern. */
  if (!window.crypto || !window.crypto.subtle) {
    knopf.disabled = true;
    knopf.textContent = "In diesem Browser nicht möglich";
    return;
  }

  const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let laeuft = false;

  function schreibe(text, art) {
    const z = document.createElement("div");
    z.className = "echtheit-zeile" + (art ? " echtheit-zeile--" + art : "");
    z.textContent = text;
    zeilen.appendChild(z);
    /* Nur mitlaufen, wenn niemand reduzierte Bewegung verlangt hat. */
    if (!ruhig) konsole.scrollTop = konsole.scrollHeight;
  }

  async function pruefen() {
    if (laeuft) return;
    laeuft = true;
    knopf.disabled = true;
    knopf.setAttribute("aria-expanded", "true");
    konsole.hidden = false;
    zeilen.textContent = "";
    ergebnis.textContent = "";
    ergebnis.className = "echtheit-ergebnis";

    schreibe("$ Fingerabdruck holen …");
    let info;
    try {
      const antwort = await fetch(ZIEL, { cache: "no-store" });
      if (!antwort.ok) throw new Error("HTTP " + antwort.status);
      info = await antwort.json();
    } catch (err) {
      schreibe("Fingerabdruck nicht erreichbar: " + err.message, "problem");
      abschluss("messproblem", "Die Prüfung selbst ist gescheitert — das ist kein bestandener Test.");
      return;
    }

    const dateien = Object.entries(info.dateien || {});
    if (!dateien.length) {
      schreibe("Der Fingerabdruck nennt keine Dateien.", "problem");
      abschluss("messproblem", "Die Prüfung selbst ist gescheitert — das ist kein bestandener Test.");
      return;
    }

    schreibe(
      "  Veröffentlicht: " +
        String(info.ausgeliefertAm || "")
          .slice(0, 19)
          .replace("T", " ") +
        " UTC"
    );
    schreibe("  Fassung:        " + (info.commitKurz || "?"));
    schreibe("  Zu prüfen:      " + dateien.length + " Dateien");
    schreibe("");

    let gleich = 0;
    let abweichend = 0;
    let fehler = 0;
    let fertig = 0;

    async function eine([pfad, soll]) {
      try {
        const a = await fetch("/" + pfad, { cache: "no-store" });
        if (!a.ok) throw new Error("HTTP " + a.status);
        const ist = await summeVon(await a.arrayBuffer());
        if (ist === soll) {
          gleich++;
          if (dateien.length <= 12 || fertig % 8 === 0) schreibe("  ok   " + pfad);
        } else {
          abweichend++;
          schreibe("  ABWEICHUNG  " + pfad, "problem");
        }
      } catch (err) {
        fehler++;
        schreibe("  nicht ladbar  " + pfad + " (" + err.message + ")", "problem");
      }
      fertig++;
      knopf.textContent = "Prüfe … " + fertig + " / " + dateien.length;
    }

    /* In kleinen Wellen statt achtzig Anfragen auf einmal. */
    const warteschlange = dateien.slice();
    await Promise.all(
      Array.from({ length: GLEICHZEITIG }, async () => {
        let naechste;
        while ((naechste = warteschlange.shift())) await eine(naechste);
      })
    );

    schreibe("");
    if (fehler > 0) {
      schreibe("Ergebnis: Messproblem — " + fehler + " Datei(en) nicht ladbar.", "problem");
      abschluss(
        "messproblem",
        "Messproblem: " + fehler + " Datei(en) konnten nicht geladen werden. Das ist kein bestandener Test."
      );
    } else if (abweichend > 0) {
      schreibe("Ergebnis: " + abweichend + " Abweichung(en) bei " + dateien.length + " Dateien.", "problem");
      abschluss("abweichung", abweichend + " von " + dateien.length + " Dateien weichen ab.");
    } else {
      schreibe("Ergebnis: " + gleich + " von " + dateien.length + " Dateien deckungsgleich.", "gut");
      abschluss(
        "gut",
        "Alle " +
          gleich +
          " Dateien stimmen mit dem offenen Quelltext überein, Fassung " +
          (info.commitKurz || "?") +
          "."
      );
    }
  }

  function abschluss(art, satz) {
    ergebnis.className = "echtheit-ergebnis echtheit-ergebnis--" + art;
    ergebnis.textContent = satz;
    knopf.disabled = false;
    knopf.textContent = "Nochmal prüfen";
    laeuft = false;
  }

  knopf.addEventListener("click", pruefen);
}

initEchtheitspruefung();
