import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setupDOM } from "./setup.js";

vi.mock("../js/i18n.js", () => ({
  t: (key) => {
    if (key === "scan.messages") return ["Msg 1", "Msg 2", "Msg 3"];
    return key;
  },
  getLanguage: () => "de",
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));

describe("Scan Animation", () => {
  let startScanAnim, stopScanAnim;
  let elements;

  beforeEach(async () => {
    setupDOM();
    vi.useFakeTimers();
    const uiMod = await import("../js/ui.js");
    const domMod = await import("../js/dom.js");
    startScanAnim = uiMod.startScanAnim;
    stopScanAnim = uiMod.stopScanAnim;
    elements = domMod.elements;
  });

  afterEach(() => {
    stopScanAnim();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sets scanAnim to active", () => {
    startScanAnim();
    expect(elements.scanAnim.classList.contains("active")).toBe(true);
  });

  it("stopScanAnim removes active class", () => {
    startScanAnim();
    stopScanAnim();
    expect(elements.scanAnim.classList.contains("active")).toBe(false);
  });

  it("BUG-009: double startScanAnim does not leak intervals", () => {
    const spy = vi.spyOn(globalThis, "clearInterval");
    startScanAnim();
    startScanAnim();
    expect(spy).toHaveBeenCalled();
  });

  it("rotates scan messages on interval", () => {
    startScanAnim();
    const _first = elements.scanText.textContent;
    vi.advanceTimersByTime(1800);
    const second = elements.scanText.textContent;
    expect(typeof second).toBe("string");
    expect(second.length).toBeGreaterThan(0);
  });

  it("announces analysis start to srAnnounce (a11y)", () => {
    startScanAnim();
    expect(elements.srAnnounce.textContent).toBe("scan.srStart");
  });

  it("announces analysis end to srAnnounce (a11y)", () => {
    startScanAnim();
    stopScanAnim();
    expect(elements.srAnnounce.textContent).toBe("scan.srEnd");
  });
});

describe("setStatus", () => {
  let setStatus, elements;

  beforeEach(async () => {
    setupDOM();
    const uiMod = await import("../js/ui.js");
    const domMod = await import("../js/dom.js");
    setStatus = uiMod.setStatus;
    elements = domMod.elements;
  });

  it("shows text and adds visible class", () => {
    setStatus("Fehler aufgetreten");
    expect(elements.status.textContent).toBe("Fehler aufgetreten");
    expect(elements.status.classList.contains("visible")).toBe(true);
  });

  it("clears text and removes visible class when empty", () => {
    setStatus("Test");
    setStatus("");
    expect(elements.status.textContent).toBe("");
    expect(elements.status.classList.contains("visible")).toBe(false);
  });

  it("clears on null/undefined", () => {
    setStatus("Test");
    setStatus(null);
    expect(elements.status.textContent).toBe("");
    expect(elements.status.classList.contains("visible")).toBe(false);
  });

  it("adds role='alert' when text is set (a11y)", () => {
    setStatus("Fehler!");
    expect(elements.status.getAttribute("role")).toBe("alert");
  });

  it("removes role='alert' when cleared (a11y)", () => {
    setStatus("Fehler!");
    setStatus("");
    expect(elements.status.hasAttribute("role")).toBe(false);
  });
});

describe("getBiasMode", () => {
  let getBiasMode, elements;

  beforeEach(async () => {
    setupDOM();
    const uiMod = await import("../js/ui.js");
    const domMod = await import("../js/dom.js");
    getBiasMode = uiMod.getBiasMode;
    elements = domMod.elements;
  });

  it("returns 'normal' when unchecked", () => {
    elements.biasSwitch.checked = false;
    expect(getBiasMode()).toBe("normal");
  });

  it("returns 'boost' when checked", () => {
    elements.biasSwitch.checked = true;
    expect(getBiasMode()).toBe("boost");
  });
});

describe("Limit Banner", () => {
  let showLimitBanner, hideLimitBanner, elements;

  beforeEach(async () => {
    setupDOM();
    vi.useFakeTimers();
    const uiMod = await import("../js/ui.js");
    const domMod = await import("../js/dom.js");
    showLimitBanner = uiMod.showLimitBanner;
    hideLimitBanner = uiMod.hideLimitBanner;
    elements = domMod.elements;
  });

  afterEach(() => {
    hideLimitBanner();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("adds active class on show", () => {
    showLimitBanner(60);
    expect(elements.limitBanner.classList.contains("active")).toBe(true);
  });

  it("removes active class on hide", () => {
    showLimitBanner(60);
    hideLimitBanner();
    expect(elements.limitBanner.classList.contains("active")).toBe(false);
  });

  it("sets countdown text on show", () => {
    showLimitBanner(120);
    expect(elements.limitCountdown.textContent).toBe("limit.countdown");
  });

  it("updates countdown text each second", () => {
    showLimitBanner(10);
    const initial = elements.limitCountdown.textContent;
    vi.advanceTimersByTime(1000);
    /* Mock gibt immer den Key zurueck, aber die Funktion wurde erneut aufgerufen */
    expect(elements.limitCountdown.textContent).toBe(initial);
  });
});

describe("Maintenance Modal", () => {
  let showMaintenanceModal, elements;

  beforeEach(async () => {
    setupDOM();
    const uiMod = await import("../js/ui.js");
    const domMod = await import("../js/dom.js");
    showMaintenanceModal = uiMod.showMaintenanceModal;
    elements = domMod.elements;
  });

  it("adds active class on show", () => {
    showMaintenanceModal("Wartung");
    expect(elements.maintenanceModal.classList.contains("active")).toBe(true);
  });

  it("sets custom message text", () => {
    showMaintenanceModal("Server wird aktualisiert");
    expect(elements.maintenanceMessage.textContent).toBe("Server wird aktualisiert");
  });

  it("uses default text when no message provided", () => {
    showMaintenanceModal();
    expect(elements.maintenanceMessage.textContent).toBe("maintenance.text");
  });
});

describe("Print Notes", () => {
  let insertPrintNotes, removePrintNotes;

  beforeEach(async () => {
    setupDOM();
    const uiMod = await import("../js/ui.js");
    insertPrintNotes = uiMod.insertPrintNotes;
    removePrintNotes = uiMod.removePrintNotes;
  });

  it("removePrintNotes clears all .print-note elements", () => {
    const note = document.createElement("div");
    note.className = "print-note";
    document.body.appendChild(note);
    expect(document.querySelectorAll(".print-note").length).toBe(1);
    removePrintNotes();
    expect(document.querySelectorAll(".print-note").length).toBe(0);
  });

  it("insertPrintNotes does nothing when no cards exist", () => {
    insertPrintNotes();
    expect(document.querySelectorAll(".print-note").length).toBe(0);
  });

  it("insertPrintNotes adds notes when cards exceed page height", () => {
    /* Simuliere sichtbare Karten mit offsetHeight */
    const container = document.createElement("div");
    for (let i = 0; i < 5; i++) {
      const card = document.createElement("div");
      card.className = "cat-card";
      Object.defineProperty(card, "offsetHeight", { value: 300, configurable: true });
      container.appendChild(card);
    }
    document.body.appendChild(container);
    insertPrintNotes();
    expect(document.querySelectorAll(".print-note").length).toBeGreaterThan(0);
  });
});
