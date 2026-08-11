/* ── Klang-Erzeugung für das Live-Erlebnis (v3.0) ──────────────────────────
 *
 * Zwei Klänge, übernommen aus dem abgenommenen Prototyp (Entscheidung des
 * Inhabers, 2026-08-11 — Variante „Daten-Puls"):
 *
 *   1. tippTon()  — geformtes Bandpass-Rauschen 1500–2000 Hz (Q 4, ~38 ms)
 *                   für die Matrix-Dekodierung des Zusammenfassungstexts.
 *   2. popTon()   — weicher Sinus-Pop 340→240 Hz (~120 ms) für ankommende
 *                   Ergebnis-Boxen.
 *
 * Beide laufen durch denselben Master (Gain 0,96) plus einen dezenten
 * Echo-Bus (Delay 90 ms, Feedback 0,25, Mix 0,22) — ein Klangbild, kein Zoo.
 * JEDER Ton bekommt weiche Hüllkurven-Rampen (linearRamp an, exponentialRamp
 * aus): abrupte Oszillator-Starts erzeugen das billige Klicken.
 *
 * Sound ist IMMER an, es gibt bewusst KEINEN Schalter in der Oberfläche
 * (Entscheidung des Inhabers; die Lautstärke regelt das Gerät).
 *
 * WICHTIG: Der AudioContext wird erst bei einer Nutzer-Geste erzeugt
 * (klangAktivieren() — der Analyse-Start ist eine solche Geste). Ohne diese
 * Aktivierung sind alle Ton-Funktionen stille No-Ops. Und: Audio darf NIE
 * etwas kaputt machen — jeder Zugriff steckt in try/catch.
 */

/* Gemeinsamer Zustand: Context, Rausch-Puffer, Master- und Echo-Bus. */
const audio = { ctx: null, rauschPuffer: null, master: null, echo: null };

/**
 * Erzeugt den AudioContext samt Bussen — MUSS aus einer Nutzer-Geste heraus
 * aufgerufen werden (Datei gewählt, Demo-Foto angetippt). Mehrfachaufrufe
 * sind harmlos; ein schlafender Context wird nur wieder geweckt.
 */
export function klangAktivieren() {
  try {
    if (!audio.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return; /* Gerät ohne Web Audio — Erlebnis läuft stumm weiter */
      const ctx = new Ctx();

      /* Eine 50-ms-Scheibe weißes Rauschen als Quelle für den Daten-Puls. */
      const puffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 0.05)), ctx.sampleRate);
      const daten = puffer.getChannelData(0);
      for (let i = 0; i < daten.length; i++) daten[i] = Math.random() * 2 - 1;

      /* Gemeinsamer Bus: Master + dezentes Feedback-Echo (90 ms).
         0,96 statt 0,8: Die Töne waren dem Inhaber im Live-Test zu leise —
         +20 % auf seine Ansage (11.08. abends, v3.0.3). */
      const master = ctx.createGain();
      master.gain.value = 0.96;
      master.connect(ctx.destination);
      const echo = ctx.createDelay(0.5);
      echo.delayTime.value = 0.09;
      const rueck = ctx.createGain();
      rueck.gain.value = 0.25;
      const mix = ctx.createGain();
      mix.gain.value = 0.22;
      echo.connect(rueck);
      rueck.connect(echo);
      echo.connect(mix);
      mix.connect(master);

      audio.ctx = ctx;
      audio.rauschPuffer = puffer;
      audio.master = master;
      audio.echo = echo;
    }
    if (audio.ctx.state === "suspended") audio.ctx.resume();
  } catch (_e) {
    /* Audio ist Beiwerk — ein Fehler hier darf nie etwas anderes stören. */
    audio.ctx = null;
  }
}

/** Liefert den aktiven Context oder null (nie werfen, nie neu erzeugen). */
function kontext() {
  try {
    if (!audio.ctx) return null;
    if (audio.ctx.state === "suspended") audio.ctx.resume();
    return audio.ctx;
  } catch (_e) {
    return null;
  }
}

/* Hüllkurve mit weichen Rampen — DIE Zutat gegen das Billig-Klicken.
   Hängt am Master UND am Echo-Bus, damit jeder Ton denselben Raum bekommt. */
function huelle(ctx, pegel, anMs, ausMs) {
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(pegel, t + anMs / 1000);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (anMs + ausMs) / 1000);
  g.connect(audio.master);
  g.connect(audio.echo);
  return g;
}

/**
 * Daten-Puls fürs Tippen: NUR geformtes Rauschen, kein Oszillator.
 * @param {number} [staerke] Anschlagstärke (der Aufrufer würfelt 0,5–1,05).
 */
export function tippTon(staerke) {
  const ctx = kontext();
  if (!ctx) return;
  const v = typeof staerke === "number" ? staerke : 1;
  try {
    const quelle = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    quelle.buffer = audio.rauschPuffer;
    filter.type = "bandpass";
    filter.frequency.value = 1500 + Math.random() * 500;
    filter.Q.value = 4;
    quelle.connect(filter);
    filter.connect(huelle(ctx, 0.13 * v, 4, 34));
    quelle.start();
    quelle.stop(ctx.currentTime + 38 / 1000 + 0.02);
  } catch (_e) {
    /* still — Audio darf nie etwas kaputt machen */
  }
}

/** Weicher Pop für ankommende Boxen: Sinus 340→240 Hz, ~120 ms. */
export function popTon() {
  const ctx = kontext();
  if (!ctx) return;
  try {
    const h = huelle(ctx, 0.11, 4, 130);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(340, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(240, ctx.currentTime + 0.08);
    o.connect(h);
    o.start();
    o.stop(ctx.currentTime + 0.16);
  } catch (_e) {
    /* still — dito */
  }
}
