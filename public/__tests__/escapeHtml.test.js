import { describe, it, expect, beforeEach } from "vitest";
import { setupDOM } from "./setup.js";

describe("escapeHtml", () => {
  let escapeHtml;

  beforeEach(async () => {
    setupDOM();
    const mod = await import("../js/dom.js");
    escapeHtml = mod.escapeHtml;
  });

  it("escapes <script> tags", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes HTML entities including quotes", () => {
    expect(escapeHtml('a "b" & <c>')).toBe("a &quot;b&quot; &amp; &lt;c&gt;");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("passes through safe text unchanged", () => {
    expect(escapeHtml("Hallo Welt 123")).toBe("Hallo Welt 123");
  });

  it("escapes angle brackets so event handlers cannot execute", () => {
    const xss = '<img onerror="alert(1)" src=x>';
    const result = escapeHtml(xss);
    expect(result).not.toContain("<img");
    expect(result).toContain("&lt;img");
  });

  it("SEC-02: escapes double and single quotes so attribute breakout is impossible", () => {
    /* escapeHtml wird in render.js im Attribut-Kontext genutzt (data-key="...").
       Ein Wert mit " darf das Attribut nicht verlassen koennen. */
    const attrBreakout = 'x" onmouseover="alert(1)';
    const result = escapeHtml(attrBreakout);
    expect(result).not.toContain('"');
    expect(result).toBe("x&quot; onmouseover=&quot;alert(1)");
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });
});
