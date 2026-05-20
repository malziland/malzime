import { elements, escapeHtml } from "./dom.js";
import { state } from "./state.js";
import { getBiasMode } from "./ui.js";
import { t, getLanguage } from "./i18n.js";

/* ── Locale-aware Zahlenformatierung ── */

function fmtNum(val, decimals = 2) {
  return new Intl.NumberFormat(getLanguage(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(val);
}

/* Setzt Balken-Breiten per CSSOM (element.style.width) statt per inline
   style="…"-Attribut. Inline-style-Attribute verstoßen gegen die strikte
   CSP (style-src 'self') und werden vom Browser blockiert; das Setzen über
   das style-Property in JS ist davon nicht betroffen. Aufrufen, nachdem ein
   Container mit [data-bar-width]-Elementen befüllt wurde. */
function applyBarWidths(container) {
  container.querySelectorAll("[data-bar-width]").forEach((el) => {
    el.style.width = el.dataset.barWidth + "%";
  });
}

/* ── Aktuellen Modus rendern (aus gecachten Daten) ── */

export function renderCurrentMode(data) {
  const mode = getBiasMode();
  const profiles = data.profiles;

  if (!profiles) {
    /* Blockiert — Fehlermeldung anzeigen */
    renderSimulation(t(data.blockedReason || "render.blockedFallback"));
    elements.facts.innerHTML = "";
    elements.targeting.innerHTML = "";
    elements.dataValue.innerHTML = "";
    elements.exportPdf.classList.add("export-btn--hidden");

    renderPrivacyRisks(data);
    renderGpsMap(data);
    return;
  }

  const profile = profiles[mode] || profiles.normal || profiles.boost || {};

  /* Prüfe ob das Profil tatsächlich Inhalt hat */
  const hasContent =
    (profile.profileText && profile.profileText.trim()) ||
    (profile.categories && Object.keys(profile.categories).length > 0);

  if (!hasContent) {
    renderSimulation(t("render.emptyProfile"));
    elements.facts.innerHTML = "";
    elements.targeting.innerHTML = "";
    elements.dataValue.innerHTML = "";
    elements.exportPdf.classList.add("export-btn--hidden");

    renderPrivacyRisks(data);
    renderGpsMap(data);
    return;
  }

  renderSimulation(profile.profileText || "");
  renderPrivacyRisks(data);
  renderGpsMap(data);
  renderCategories(profile);
  renderAdTargeting(profile);
  const isAnimal = data.meta?.mode === "animal";
  if (isAnimal) {
    elements.dataValue.innerHTML = "";
  } else {
    renderDataValue(profile);
  }
  elements.exportPdf.classList.remove("export-btn--hidden");
}

/* ── Rendering: Kategorie-Karten ── */

function renderCategories(profile) {
  const categories = profile.categories || {};
  const entries = Object.entries(categories);

  if (entries.length === 0) {
    elements.facts.innerHTML = "";
    return;
  }

  elements.facts.innerHTML = entries
    .map(([key, cat]) => {
      const pct = Math.round((typeof cat.confidence === "number" ? cat.confidence : 0) * 100);
      const cls = pct >= 70 ? "high" : pct >= 40 ? "med" : "low";
      return `
        <div class="cat-card" data-key="${escapeHtml(key)}">
          <div class="cat-head">
            <span class="cat-label">${escapeHtml(cat.label)}</span>
            <span class="cat-conf ${cls}">${pct}%</span>
          </div>
          <p class="cat-value">${escapeHtml(cat.value)}</p>
          <div class="conf-track"><div class="conf-bar ${cls}" data-bar-width="${pct}"></div></div>
        </div>
      `;
    })
    .join("");
  applyBarWidths(elements.facts);
}

/* ── Rendering: Werbung + Manipulation ── */

function renderAdTargeting(profile) {
  const ads = profile.ad_targeting || [];
  const triggers = profile.manipulation_triggers || [];

  if (ads.length === 0 && triggers.length === 0) {
    elements.targeting.innerHTML = "";
    return;
  }

  let html = '<div class="target-stack">';

  if (ads.length > 0) {
    html += `
      <div class="target-card">
        <h3>${t("targeting.adsTitle")}</h3>
        <div class="tag-cloud">
          ${ads.map((ad) => `<span class="tag">${escapeHtml(ad)}</span>`).join("")}
        </div>
      </div>
    `;
  }

  if (triggers.length > 0) {
    html += `
      <div class="target-card warn">
        <h3>${t("targeting.manipTitle")}</h3>
        <ul class="trigger-list">
          ${triggers.map((trigger) => `<li>${escapeHtml(trigger)}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  html += "</div>";
  elements.targeting.innerHTML = html;
}

/* ── Rendering: Privacy-Risiken + EXIF ── */

function getExifLabels() {
  return {
    make: t("exif.make"),
    model: t("exif.model"),
    dateTimeOriginal: t("exif.dateTimeOriginal"),
  };
}

function formatExifValue(key, value) {
  if (key === "dateTimeOriginal" && value) {
    try {
      const d = new Date(value);
      return d.toLocaleString(getLanguage(), {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      /* date parse failed — show raw value */
    }
  }
  return String(value);
}

function renderPrivacyRisks(data) {
  const risks = data.privacyRisks || [];
  const exif = data.exif || {};
  const exifEntries = Object.entries(exif).filter(([k]) => k !== "gpsLatitude" && k !== "gpsLongitude");

  const hasCamera = exif.make || exif.model;
  if (risks.length === 0 && (!hasCamera || exifEntries.length === 0)) {
    elements.privacy.innerHTML = "";
    return;
  }

  let html = '<div class="privacy-stack">';

  if (hasCamera && exifEntries.length > 0) {
    const labels = getExifLabels();
    html += `
      <div class="meta-card">
        <h3>${t("exif.sectionTitle")}</h3>
        <table class="meta-table">
          ${exifEntries.map(([k, v]) => `<tr><td>${escapeHtml(labels[k] || k)}</td><td>${escapeHtml(formatExifValue(k, v))}</td></tr>`).join("")}
        </table>
      </div>
    `;
  }

  if (risks.length > 0) {
    html += `
      <div class="meta-card warn">
        <h3>${t("privacy.sectionTitle")}</h3>
        <ul>${risks.map((r) => `<li>${escapeHtml(t(r))}</li>`).join("")}</ul>
      </div>
    `;
  }

  html += "</div>";
  elements.privacy.innerHTML = html;
}

/* ── Rendering: GPS-Karte ── */

async function renderGpsMap(data) {
  const exif = data.exif || {};

  if (state.gpsMapInstance) {
    state.gpsMapInstance.remove();
    state.gpsMapInstance = null;
  }
  elements.gpsMap.innerHTML = "";

  if (exif.gpsLatitude == null || exif.gpsLongitude == null) return;
  if (typeof L === "undefined") return;

  const lat = exif.gpsLatitude;
  const lng = exif.gpsLongitude;

  try {
    /* Geocoding wurde bereits beim EXIF-Parsen gestartet (parallel zur Analyse).
       GPS verlässt nie den Server — Nominatim wird direkt vom Browser aufgerufen. */
    /* BUG-002: Lokale Referenz — verhindert dass ein neueres Geocoding-Promise
       ueberschrieben wird wenn zwischen await und Cleanup eine neue Analyse startet */
    const geocodePromise = state.pendingGeocode;
    const address = geocodePromise ? await geocodePromise : null;
    if (state.pendingGeocode === geocodePromise) state.pendingGeocode = null;

    elements.gpsMap.innerHTML = `
      <div class="map-wrapper">
        <h3>${t("gps.sectionTitle")}</h3>
        <div id="gpsMapLeaflet"></div>
      </div>
    `;

    state.gpsMapInstance = L.map("gpsMapLeaflet").setView([lat, lng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      referrerPolicy: "origin",
    }).addTo(state.gpsMapInstance);

    const popupText = address
      ? `<strong>${t("gps.popup")}</strong><br>${escapeHtml(address)}`
      : `<strong>${t("gps.popup")}</strong><br>${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    L.marker([lat, lng]).addTo(state.gpsMapInstance).bindPopup(popupText).openPopup();
  } catch (_err) {
    /* BUG-015: Leaflet-Fehler abfangen statt Unhandled Promise Rejection */
    elements.gpsMap.innerHTML = "";
  }
}

/* ── Rendering: Profil-Verdict ── */

function renderSimulation(text) {
  if (!text) {
    elements.simulation.innerHTML = "";
    return;
  }

  elements.simulation.innerHTML = `
    <div class="verdict">
      <div class="verdict-head">
        <svg class="verdict-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M3.6 19.8h16.8a1.2 1.2 0 001.04-1.8L13.04 4.2a1.2 1.2 0 00-2.08 0L2.56 18a1.2 1.2 0 001.04 1.8z"/></svg>
        <h3>${t("verdict.title")}</h3>
      </div>
      <p class="verdict-text">${escapeHtml(text)}</p>
    </div>
  `;
}

/* ── Rendering: Datenwert-Rechner ── */

/* Keys muessen zum JSON-Schema in prompts.js passen (categories-Objekt) */
const DATA_VALUE_MAP = {
  alter_geschlecht: 0.06,
  herkunft: 0.06,
  einkommen: 0.14,
  bildung: 0.07,
  beziehungsstatus: 0.07,
  interessen: 0.05,
  persoenlichkeit: 0.05,
  charakterzuege: 0.05,
  politisch: 0.11,
  gesundheit: 0.16,
  kaufkraft: 0.13,
  verletzlichkeit: 0.15,
  werbeprofil: 0.12,
};
const DATA_VALUE_DEFAULT = 0.06;
const USERS_GLOBAL = 2_000_000_000;

function computeDataValue(profile) {
  const categories = profile.categories || {};
  const entries = Object.entries(categories);
  if (entries.length === 0) return null;

  let total = 0;
  const breakdown = [];

  for (const [key, cat] of entries) {
    const baseVal = DATA_VALUE_MAP[key] || DATA_VALUE_DEFAULT;
    const conf = typeof cat.confidence === "number" ? cat.confidence : 0.5;
    const val = baseVal * conf;
    total += val;
    breakdown.push({ label: cat.label, value: val, confidence: conf });
  }

  /* Bonus für ad_targeting und manipulation_triggers */
  const ads = profile.ad_targeting || [];
  const triggers = profile.manipulation_triggers || [];
  total += ads.length * 0.02;
  total += triggers.length * 0.04;

  breakdown.sort((a, b) => b.value - a.value);

  return { perUser: total, global: total * USERS_GLOBAL, breakdown };
}

function formatEuro(val) {
  if (val >= 1_000_000_000_000) return t("dv.trillions", { value: fmtNum(val / 1_000_000_000_000, 1) });
  if (val >= 1_000_000_000) return t("dv.billions", { value: fmtNum(val / 1_000_000_000, 1) });
  if (val >= 1_000_000) return t("dv.millions", { value: fmtNum(val / 1_000_000, 1) });
  return t("dv.euro", { value: fmtNum(val) });
}

function renderDataValue(profile) {
  const result = computeDataValue(profile);
  if (!result) {
    elements.dataValue.innerHTML = "";
    return;
  }

  const top5 = result.breakdown.slice(0, 5);
  const maxVal = top5[0]?.value || 1;
  const RESALES_PER_YEAR = 90;
  const personalYearly = result.perUser * RESALES_PER_YEAR;
  const AD_PLATFORMS_YEARLY = 50;
  const totalYearly = personalYearly + AD_PLATFORMS_YEARLY;

  elements.dataValue.innerHTML = `
    <div class="dv-card">
      <div class="dv-header">
        <svg class="dv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
        </svg>
        <h3>${t("dv.title")}</h3>
      </div>
      <div class="dv-hero-value">${t("dv.heroValue", { value: fmtNum(result.perUser) })}</div>
      <p class="dv-subtitle">${t("dv.subtitle")}</p>

      <div class="dv-explain">
        <h4>${t("dv.explainTitle")}</h4>
        <p>${t("dv.explain1", { amount: fmtNum(result.perUser) })}</p>
        <p>${t("dv.explain2", { resales: RESALES_PER_YEAR })}</p>
      </div>

      <div class="dv-scale">
        <div class="dv-scale-row">
          <span class="dv-scale-label">${t("dv.resalesLabel", { resales: RESALES_PER_YEAR })}</span>
          <span class="dv-scale-value">${t("dv.resalesValue", { amount: new Intl.NumberFormat(getLanguage()).format(Math.round(personalYearly)) })}</span>
        </div>
      </div>

      <div class="dv-explain dv-explain-highlight">
        <h4>${t("dv.marketsTitle")}</h4>
        <p>${t("dv.marketsIntro")}</p>
        <p>${t("dv.brokerExplain", { resales: RESALES_PER_YEAR, brokerYearly: personalYearly.toFixed(0) })}</p>
        <p>${t("dv.platformExplain", { adYearly: AD_PLATFORMS_YEARLY })}</p>
        <p>${t("dv.totalExplain", { totalYearly: Math.round(totalYearly) })}</p>
      </div>

      <div class="dv-scale">
        <div class="dv-scale-row">
          <span class="dv-scale-label">${t("dv.labelBroker")}</span>
          <span class="dv-scale-value">${t("dv.labelBrokerValue", { amount: personalYearly.toFixed(0) })}</span>
        </div>
        <div class="dv-divider"></div>
        <div class="dv-scale-row">
          <span class="dv-scale-label">${t("dv.labelMeta")}</span>
          <span class="dv-scale-value">${t("dv.labelMetaValue")}</span>
        </div>
        <div class="dv-scale-row">
          <span class="dv-scale-label">${t("dv.labelGoogle")}</span>
          <span class="dv-scale-value">${t("dv.labelGoogleValue")}</span>
        </div>
        <div class="dv-scale-row">
          <span class="dv-scale-label">${t("dv.labelTiktok")}</span>
          <span class="dv-scale-value">${t("dv.labelTiktokValue")}</span>
        </div>
        <div class="dv-divider"></div>
        <div class="dv-scale-row">
          <span class="dv-scale-label">${t("dv.labelTotal")}</span>
          <span class="dv-scale-value">${t("dv.labelTotalValue", { total: Math.round(totalYearly) })}</span>
        </div>
      </div>

      <div class="dv-scale">
        <div class="dv-scale-row">
          <span class="dv-scale-label">${t("dv.globalUsersLabel")}</span>
          <span class="dv-scale-value">${formatEuro(result.global)}</span>
        </div>
        <div class="dv-scale-row">
          <span class="dv-scale-label">${t("dv.globalMarketLabel")}</span>
          <span class="dv-scale-value">${t("dv.globalMarketValue")}</span>
        </div>
      </div>

      <div class="dv-explain">
        <h4>${t("dv.auctionTitle")}</h4>
        <p>${t("dv.auction1")}</p>
        <p>${t("dv.auction2")}</p>
      </div>

      <div class="dv-explain">
        <h4>${t("dv.photosTitle")}</h4>
        <p>${t("dv.photos1")}</p>
        <p>${t("dv.photos2")}</p>
      </div>

      <div class="dv-breakdown">
        <h4>${t("dv.breakdownTitle")}</h4>
        ${top5
          .map(
            (item) => `
          <div class="dv-bar-row">
            <span class="dv-bar-label">${escapeHtml(item.label)}</span>
            <div class="dv-bar-track">
              <div class="dv-bar-fill" data-bar-width="${Math.round((item.value / maxVal) * 100)}"></div>
            </div>
            <span class="dv-bar-val">${fmtNum(item.value)} \u20ac</span>
          </div>
        `
          )
          .join("")}
      </div>

      <p class="dv-footnote">${t("dv.footnote")}</p>
    </div>
  `;
  applyBarWidths(elements.dataValue);
}
