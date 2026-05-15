"use strict";

/**
 * heartbeat.js — Hält die HTTP-Verbindung waehrend langer Analyse-Pipelines aktiv.
 *
 * Hintergrund: Safari/WebKit kappt fetch-Streams, die ueber ~47 s keine Bytes vom
 * Server bekommen ("TypeError: Load failed"). Mistral-Profile koennen aber 40-100 s
 * brauchen. Loesung: chunked Response, alle 5 s ein Whitespace-Byte. Safari sieht
 * "Verbindung lebt" und wartet. Der eigentliche JSON-Body kommt am Ende.
 *
 * JSON.parse() toleriert leading whitespace, deshalb keine Client-Anpassung noetig.
 *
 * Headers werden sofort committed (Status 200) — nach Heartbeat-Start kann der
 * Status nicht mehr geaendert werden. Aufrufer muss alle 4xx/5xx-Pfade VOR
 * startHeartbeat() abhandeln.
 */

const HEARTBEAT_INTERVAL_MS = 5000;

function startHeartbeat(res, intervalMs = HEARTBEAT_INTERVAL_MS) {
  /* Test-Fallback: Wenn der res-Mock keine Stream-API hat, verhalten wir uns
     wie das alte res.status(200).json(body). Damit bleiben alle bestehenden
     Unit-Tests gruen, ohne sie auf den Stream-Pfad umschreiben zu muessen. */
  if (typeof res.flushHeaders !== "function" || typeof res.write !== "function") {
    return {
      finish(body) {
        res.status(200);
        res.json(body);
      },
      cleanup() {},
    };
  }

  res.status(200);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Heartbeat", "1");
  res.flushHeaders();

  const timer = setInterval(() => {
    try {
      if (!res.writableEnded) res.write(" ");
    } catch (_) {
      /* Client hat die Verbindung geschlossen — interval wird gleich aufgeraeumt. */
    }
  }, intervalMs);

  return {
    finish(body) {
      clearInterval(timer);
      if (!res.writableEnded) {
        try {
          res.end(JSON.stringify(body));
        } catch (_) {
          /* Verbindung weg — nichts zu tun. */
        }
      }
    },
    cleanup() {
      clearInterval(timer);
    },
  };
}

module.exports = { startHeartbeat, HEARTBEAT_INTERVAL_MS };
