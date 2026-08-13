const { getStats, boostLimit, resetCounter, setMaintenanceMode, getMaintenanceStatus } = require("./counter");
const { verifyAdminToken, createNonce, verifyNonce, consumeNonce, cleanupNonces, safeCompare } = require("./auth");

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const ADMIN_PAGE_STYLE = `*,*::before,*::after{box-sizing:border-box;margin:0}
body{font-family:'Inter',system-ui,sans-serif;background:#0a0c10;color:#c8cdd8;
  display:flex;align-items:center;justify-content:center;min-height:100vh;
  position:relative;overflow:hidden}
body::before{content:'';position:fixed;inset:0;
  background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,.015) 2px,rgba(255,255,255,.015) 4px);
  pointer-events:none;z-index:1}
.card{text-align:center;padding:2.5rem 3rem;background:#161921;border:1px solid #1e222d;
  border-radius:12px;position:relative;z-index:2;max-width:400px;width:90%}
.icon{width:64px;height:64px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem;
  font-size:1.75rem}
.icon--warn{background:rgba(251,191,36,.12);color:#fbbf24}
.icon--ok{background:rgba(74,222,128,.12);color:#4ade80}
.title{font-family:'JetBrains Mono',monospace;font-size:1.1rem;color:#e8ecf4;margin-bottom:.5rem}
.msg{color:#9ca3af;font-size:.9rem;line-height:1.5;margin-bottom:1.25rem}
.btn{display:inline-block;padding:.6rem 1.5rem;background:rgba(56,189,248,.1);
  border:1px solid rgba(56,189,248,.25);border-radius:6px;color:#38bdf8;
  font-size:.9rem;cursor:pointer;transition:background .2s;font-family:inherit}
.btn:hover{background:rgba(56,189,248,.2)}
.link{display:inline-block;padding:.5rem 1.25rem;background:rgba(56,189,248,.1);
  border:1px solid rgba(56,189,248,.25);border-radius:6px;color:#38bdf8;
  text-decoration:none;font-size:.85rem;transition:background .2s}
.link:hover{background:rgba(56,189,248,.2)}
.redirect{color:#6b7280;font-size:.75rem;margin-top:1rem}
.cancel{color:#6b7280;font-size:.8rem;margin-top:.75rem}
.cancel a{color:#9ca3af;text-decoration:none}
.cancel a:hover{color:#e8ecf4}`;

/**
 * SEC-001: Bestaetigungsseite — zeigt Warnung + POST-Formular mit Nonce.
 * Wird bei GET+HMAC angezeigt, fuehrt KEINE Mutation aus.
 */
function adminConfirmPage(action, title, message, nonce) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeAction = escapeHtml(action);
  const safeNonce = escapeHtml(nonce);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle} — malziME</title>
<style>${ADMIN_PAGE_STYLE}</style></head>
<body>
<div class="card">
  <div class="icon icon--warn">&#9888;</div>
  <div class="title">${safeTitle}</div>
  <p class="msg">${safeMessage}</p>
  <form method="POST" action="/api/admin/${safeAction}">
    <input type="hidden" name="nonce" value="${safeNonce}">
    <button type="submit" class="btn">Bestaetigen</button>
  </form>
  <p class="cancel"><a href="/stats">&larr; Abbrechen</a></p>
</div>
</body></html>`;
}

/**
 * Erfolgsseite — wird nach erfolgreicher Mutation angezeigt.
 */
function adminSuccessPage(title, message) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle} — malziME</title><meta http-equiv="refresh" content="3;url=/stats">
<style>${ADMIN_PAGE_STYLE}</style></head>
<body>
<div class="card">
  <div class="icon icon--ok">&#10003;</div>
  <div class="title">${safeTitle}</div>
  <p class="msg">${safeMessage}</p>
  <a href="/stats" class="link">Stats ansehen &rarr;</a>
  <p class="redirect">Automatische Weiterleitung in 3 Sekunden&hellip;</p>
</div>
</body></html>`;
}

async function handleAdmin(req, res, secrets) {
  const path = req.path || "";
  const action = path.includes("maintenance")
    ? "maintenance"
    : path.includes("boost")
      ? "boost"
      : path.includes("reset")
        ? "reset"
        : "";

  /* Auth: Bearer (POST), HMAC (GET → Bestaetigungsseite), oder Nonce (POST → Mutation) */
  const auth = req.headers["authorization"] || "";
  const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const hmacToken = req.query.hmac || "";
  const nonceToken = (req.body && req.body.nonce) || "";

  /* SEC-01: Konstantzeitiger Vergleich — kein Timing-Seitenkanal aufs Admin-Secret. */
  const isBearerAuth = bearerToken && safeCompare(bearerToken, secrets.adminSecret.value());
  const isHmacAuth =
    hmacToken &&
    action &&
    action !== "maintenance" &&
    req.method === "GET" &&
    verifyAdminToken(hmacToken, action, secrets.adminSecret.value());
  const isNonceAuth =
    nonceToken && action && req.method === "POST" && verifyNonce(nonceToken, action, secrets.adminSecret.value());

  if (!isBearerAuth && !isHmacAuth && !isNonceAuth) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    /* SEC-001: GET+HMAC → Bestaetigungsseite (KEINE Mutation) */
    if (isHmacAuth && req.method === "GET") {
      const nonce = createNonce(action, secrets.adminSecret.value());
      if (action === "boost") {
        res.type("html").send(adminConfirmPage("boost", "Boost bestaetigen", "Limit um 100 Analysen erhoehen?", nonce));
      } else if (action === "reset") {
        res
          .type("html")
          .send(adminConfirmPage("reset", "Reset bestaetigen", "Stundenzaehler komplett zuruecksetzen?", nonce));
      } else {
        res.status(404).json({ error: "Unknown action" });
      }
      return;
    }

    /* SEC-002: Nonce-Replay-Schutz — jede Nonce nur 1x verwendbar */
    if (isNonceAuth) {
      const consumed = await consumeNonce(nonceToken);
      if (!consumed) {
        res.status(403).json({ error: "Nonce already used" });
        return;
      }
      /* Alte Nonces aufräumen (fire-and-forget) */
      cleanupNonces().catch((err) => {
        console.log(JSON.stringify({ warning: "nonce-cleanup-error", error: err.message }));
      });
    }

    /* Mutation ausfuehren (POST+Bearer oder POST+Nonce) */
    if (path === "/boost" || path === "/api/admin/boost") {
      /* SEC-002: Nonce-Auth bekommt immer 100. Custom Amount nur per Bearer. */
      const amount = isNonceAuth
        ? 100
        : Math.min(Math.max(Number((req.body && req.body.amount) || 100) || 100, 1), 500);
      /* SEC-2026-08-13-D: Rückgabewert auswerten. Vorher wurde er verworfen und
         die Antwort meldete IMMER Erfolg — auch wenn boostLimit ablehnte
         (Obergrenze erreicht, Grenze nicht lesbar). Genau dann läuft eine Reaktion
         auf einen Überlast-Alarm, und die Antwort muss die Wahrheit sagen (KERN 10:
         Vollzugsmeldung am Rückgabewert, nicht an der Reihenfolge). */
      const boost = await boostLimit(amount);
      const data = await getStats();
      if (boost && boost.abgelehnt) {
        const grund =
          boost.limit == null
            ? "Die aktuelle Grenze war nicht lesbar."
            : `Die Obergrenze (${data.current.limit}) ist erreicht.`;
        if (isNonceAuth) {
          res.type("html").send(adminSuccessPage("Boost abgelehnt", grund));
        } else {
          res.json({ ok: false, action: "boost", abgelehnt: true, grund, stats: data });
        }
      } else if (isNonceAuth) {
        res
          .type("html")
          .send(adminSuccessPage("Boost", `+${amount} Analysen hinzugefuegt. Neues Limit: ${data.current.limit}`));
      } else {
        res.json({ ok: true, action: "boost", stats: data });
      }
    } else if (path === "/reset" || path === "/api/admin/reset") {
      await resetCounter();
      const data = await getStats();
      if (isNonceAuth) {
        res.type("html").send(adminSuccessPage("Reset", "Stundenzaehler zurueckgesetzt."));
      } else {
        res.json({ ok: true, action: "reset", stats: data });
      }
    } else if (path === "/maintenance" || path === "/api/admin/maintenance") {
      /* Maintenance nur per Bearer-Auth (kein HMAC/Nonce-Flow nötig) */
      if (!isBearerAuth) {
        res.status(403).json({ error: "Maintenance requires Bearer auth" });
        return;
      }
      const enabled = req.body && req.body.enabled !== undefined ? !!req.body.enabled : true;
      const message = String((req.body && req.body.message) || "").slice(0, 500);
      await setMaintenanceMode(enabled, message);
      const status = await getMaintenanceStatus();
      res.json({ ok: true, action: "maintenance", maintenance: status });
    } else {
      res.status(404).json({ error: "Unknown action" });
    }
  } catch (err) {
    console.log(JSON.stringify({ warning: "admin-error", error: err.message }));
    res.status(500).json({ error: "Admin action failed" });
  }
}

module.exports = { handleAdmin };
