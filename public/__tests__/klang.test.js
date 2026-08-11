import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/* Nachbau der Web-Audio-Schnittstelle — genau die Teile, die klang.js nutzt.
   Zählt Quellen (Tipp-Rauschen) und Oszillatoren (Box-Pop) mit. */
function baueMockAudioContext() {
  class MockGain {
    constructor() {
      this.gain = {
        value: 0,
        setValueAtTime() {},
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {},
      };
    }
    connect() {}
  }
  return class MockAudioContext {
    constructor() {
      MockAudioContext.instanzen.push(this);
      this.sampleRate = 44100;
      this.currentTime = 0;
      this.state = "running";
      this.destination = {};
      this.quellen = 0;
      this.oszillatoren = 0;
    }
    createBuffer(_kanaele, laenge) {
      return { getChannelData: () => new Float32Array(laenge) };
    }
    createGain() {
      return new MockGain();
    }
    createDelay() {
      return { delayTime: { value: 0 }, connect() {} };
    }
    createBufferSource() {
      this.quellen += 1;
      return { buffer: null, connect() {}, start() {}, stop() {} };
    }
    createBiquadFilter() {
      return { type: "", frequency: { value: 0 }, Q: { value: 0 }, connect() {} };
    }
    createOscillator() {
      this.oszillatoren += 1;
      return {
        type: "",
        frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        start() {},
        stop() {},
      };
    }
    resume() {
      this.state = "running";
    }
  };
}

describe("Klang (v3.0)", () => {
  beforeEach(() => {
    /* Jeder Test bekommt ein frisches Modul (klang.js hält den Context
       modul-global) und eine Umgebung ohne Web Audio. */
    vi.resetModules();
    delete window.AudioContext;
    delete window.webkitAudioContext;
  });

  afterEach(() => {
    delete window.AudioContext;
    delete window.webkitAudioContext;
  });

  it("ohne Nutzer-Geste / ohne AudioContext wirft nichts — alles stille No-Ops", async () => {
    const klang = await import("../js/klang.js");
    /* jsdom kennt kein Web Audio — genau der Fall „Gerät ohne Audio". */
    expect(() => klang.tippTon(1)).not.toThrow();
    expect(() => klang.popTon()).not.toThrow();
    expect(() => klang.klangAktivieren()).not.toThrow();
    expect(() => klang.tippTon()).not.toThrow();
    expect(() => klang.popTon()).not.toThrow();
  });

  it("mit Nutzer-Geste: EIN Context entsteht, Tipp-Ton nutzt Rauschen, Pop den Oszillator", async () => {
    const Mock = baueMockAudioContext();
    Mock.instanzen = [];
    window.AudioContext = Mock;
    const klang = await import("../js/klang.js");

    klang.klangAktivieren();
    expect(Mock.instanzen.length).toBe(1);

    klang.tippTon(0.8);
    expect(Mock.instanzen[0].quellen).toBe(1);
    expect(Mock.instanzen[0].oszillatoren).toBe(0);

    klang.popTon();
    expect(Mock.instanzen[0].oszillatoren).toBe(1);

    /* Mehrfach aktivieren erzeugt keinen zweiten Context. */
    klang.klangAktivieren();
    expect(Mock.instanzen.length).toBe(1);
  });

  it("Ton-Funktionen schlucken interne Fehler — Audio darf nie etwas kaputt machen", async () => {
    const Mock = baueMockAudioContext();
    Mock.instanzen = [];
    window.AudioContext = Mock;
    const klang = await import("../js/klang.js");
    klang.klangAktivieren();

    /* Ab jetzt bricht die Audio-Schicht zusammen: */
    Mock.instanzen[0].createBufferSource = () => {
      throw new Error("Audio kaputt");
    };
    Mock.instanzen[0].createOscillator = () => {
      throw new Error("Audio kaputt");
    };
    expect(() => klang.tippTon(1)).not.toThrow();
    expect(() => klang.popTon()).not.toThrow();
  });

  it("schlägt schon die Aktivierung fehl, bleiben die Töne stille No-Ops", async () => {
    window.AudioContext = class {
      constructor() {
        throw new Error("Autoplay verboten");
      }
    };
    const klang = await import("../js/klang.js");
    expect(() => klang.klangAktivieren()).not.toThrow();
    expect(() => klang.tippTon(1)).not.toThrow();
    expect(() => klang.popTon()).not.toThrow();
  });
});
