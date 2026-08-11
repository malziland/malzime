import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

/**
 * Accessibility tests — prüft die ECHTE index.html auf Safari-Kompatibilität.
 *
 * Safari tabbt standardmäßig NUR zu Text-Inputs (nicht zu Links, Buttons,
 * Checkboxen, File-Inputs). ALLE interaktiven Elemente brauchen ein
 * explizites tabindex="0" im HTML-Attribut.
 *
 * Diese Tests lesen die echte index.html ein, damit keine Diskrepanz
 * zwischen Test-HTML und Produktions-HTML entstehen kann.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const html = readFileSync(resolve(__dirname, "../index.html"), "utf-8");

function loadPage() {
  /* Nur den <body>-Inhalt extrahieren (ohne <script>-Tags) */
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  const cleaned = body.replace(/<script[\s\S]*?<\/script>/gi, "");
  document.body.innerHTML = cleaned;
}

describe("Safari keyboard accessibility (index.html)", () => {
  beforeEach(() => loadPage());

  it("skip-link exists and points to #main", () => {
    const link = document.querySelector(".skip-link");
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("#main");
  });

  it("honeypot field has tabindex=-1", () => {
    const hp = document.getElementById("website");
    expect(hp).toBeTruthy();
    expect(hp.getAttribute("tabindex")).toBe("-1");
  });

  it("bias toggle has aria-label", () => {
    const toggle = document.getElementById("biasSwitch");
    expect(toggle.getAttribute("aria-label")).toBeTruthy();
  });

  it("info icons have tabindex=0 and role=button", () => {
    const icons = document.querySelectorAll(".info-icon");
    expect(icons.length).toBe(2);
    icons.forEach((icon) => {
      expect(icon.getAttribute("tabindex")).toBe("0");
      expect(icon.getAttribute("role")).toBe("button");
      expect(icon.getAttribute("aria-label")).toBeTruthy();
    });
  });

  /*
   * Safari-Regel: Jedes interaktive Element (Button, Checkbox, File-Input,
   * Link) muss tabindex="0" haben, sonst überspringt Safari es.
   */

  it("file input has explicit tabindex=0", () => {
    const input = document.getElementById("fileInput");
    expect(input.getAttribute("tabindex")).toBe("0");
  });

  it("bias toggle checkbox has explicit tabindex=0", () => {
    const toggle = document.getElementById("biasSwitch");
    expect(toggle.getAttribute("tabindex")).toBe("0");
  });

  it("all demo buttons have explicit tabindex=0", () => {
    const buttons = document.querySelectorAll(".demo-thumb");
    expect(buttons.length).toBe(3);
    buttons.forEach((btn) => {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.getAttribute("tabindex")).toBe("0");
    });
  });

  it("export button has explicit tabindex=0", () => {
    const btn = document.getElementById("exportPdf");
    expect(btn.getAttribute("tabindex")).toBe("0");
  });

  it("v3.0.0: das Hinweis-Modal existiert nicht mehr im Markup (Analyse startet direkt)", () => {
    expect(document.getElementById("disclaimerModal")).toBeNull();
    expect(document.getElementById("disclaimerConfirm")).toBeNull();
  });

  it("opensource link has explicit tabindex=0", () => {
    const link = document.querySelector(".opensource-link");
    expect(link).toBeTruthy();
    expect(link.getAttribute("tabindex")).toBe("0");
  });

  it("support link has explicit tabindex=0", () => {
    const link = document.querySelector(".support-btn");
    expect(link).toBeTruthy();
    expect(link.getAttribute("tabindex")).toBe("0");
  });

  it("footer links have explicit tabindex=0", () => {
    const links = document.querySelectorAll(".site-footer a");
    expect(links.length).toBeGreaterThanOrEqual(2);
    links.forEach((link) => {
      expect(link.getAttribute("tabindex")).toBe("0");
    });
  });

  it("ALL buttons and inputs (except honeypot) have explicit tabindex=0", () => {
    const elements = document.querySelectorAll("button, input");
    elements.forEach((el) => {
      /* Honeypot überspringen */
      if (el.id === "website") return;
      const tab = el.getAttribute("tabindex");
      expect(tab).toBe("0", `${el.tagName}#${el.id || el.className} fehlt tabindex="0" (Safari)`);
    });
  });

  it("ALL links have explicit tabindex=0", () => {
    const links = document.querySelectorAll("a[href]");
    links.forEach((link) => {
      const tab = link.getAttribute("tabindex");
      expect(tab).toBe("0", `Link "${link.textContent.trim()}" fehlt tabindex="0" (Safari)`);
    });
  });

  it("tab order: skip → file → info1 → toggle → info2 → demos → links", () => {
    const tabbable = Array.from(document.querySelectorAll('[tabindex="0"]')).filter((el) => !el.hidden);

    /* Skip-link zuerst */
    expect(tabbable[0].classList.contains("skip-link")).toBe(true);

    /* fileInput vor biasSwitch */
    const fileIdx = tabbable.findIndex((el) => el.id === "fileInput");
    const toggleIdx = tabbable.findIndex((el) => el.id === "biasSwitch");
    expect(fileIdx).toBeLessThan(toggleIdx);

    /* biasSwitch zwischen den zwei info-icons */
    const infoIndices = [];
    tabbable.forEach((el, i) => {
      if (el.classList.contains("info-icon")) infoIndices.push(i);
    });
    expect(infoIndices.length).toBe(2);
    expect(toggleIdx).toBeGreaterThan(infoIndices[0]);
    expect(toggleIdx).toBeLessThan(infoIndices[1]);
  });
});
