"use strict";

/* Betriebswerte kommen seit 30.08.2026 aus Firestore; hier gestellt, damit
   der Test nicht das Protokoll des Satz-Ladens mitzaehlt. */

/* Der Einstellungssatz als Kulisse: Dieser Test prueft etwas anderes, braucht
   aber Betriebswerte in der Kette. Was OHNE Satz passiert, prueft
   ohne-einstellungssatz.test.js — an EINER Stelle, fuer alle Wege. */
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const { handleErrors } = require("../handle-errors");

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
    end() {
      return this;
    },
  };
}

function mockReq(body) {
  return { method: "POST", body, headers: {}, ip: "test-" + Math.random() };
}

describe("handleErrors", () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  function loggedPayload() {
    expect(errorSpy).toHaveBeenCalledTimes(1);
    return JSON.parse(errorSpy.mock.calls[0][0]);
  }

  test("loggt whitelisted Felder inkl. Lesefehler-Diagnose (errorDetail, fileSizeKb)", async () => {
    const res = mockRes();
    await handleErrors(
      mockReq({
        errorName: "Error",
        errorMessage: "read_failed",
        phase: "image-read",
        fileFormat: "decl:image/jpeg",
        errorDetail: "NotReadableError",
        fileSizeKb: 3072,
        durationMs: 120,
      }),
      res
    );
    expect(res.statusCode).toBe(204);
    const logged = loggedPayload();
    expect(logged.type).toBe("client-error");
    expect(logged.errorMessage).toBe("read_failed");
    expect(logged.fileFormat).toBe("decl:image/jpeg");
    expect(logged.errorDetail).toBe("NotReadableError");
    expect(logged.fileSizeKb).toBe(3072);
  });

  test("client.automatisiert (navigator.webdriver) kommt an, ein erfundenes client-Feld nicht (07.09.2026)", async () => {
    /* Nachuntersuchung 07.09.2026: zehn "demo-image-load"-Meldungen in 30
       Tagen, alle von automatisierten Browsern — erkennbar erst nach einer
       Stunde Messen, weil das Kennzeichen fehlte, das jeder solche Browser
       selbst setzt. Ein Ja/Nein-Wert, kein Personenbezug, kein Filter. */
    const res = mockRes();
    await handleErrors(
      mockReq({
        errorMessage: "Failed to fetch",
        phase: "demo-image-load",
        client: { automatisiert: true, saveData: false, erfunden: "nein", language: "en-US" },
      }),
      res
    );
    expect(res.statusCode).toBe(204);
    const logged = loggedPayload();
    expect(logged.client.automatisiert).toBe(true);
    expect(logged.client.saveData).toBe(false);
    expect(logged.client.language).toBe("en-US");
    expect(logged.client).not.toHaveProperty("erfunden");
  });

  test("Lesefehler-Diagnose (08.09.2026): msSeitAuswahl und zweiterLeseweg kommen an, gekappt und typgeprueft", async () => {
    /* Fuenf Android-Geraete einer Klasse: NotReadableError, zwei Kinder mit
       derselben Datei zweimal. Ob ein zweiter Leseweg hilft und wie lang die
       Auswahl her war, stand nirgends. Zwei Felder ohne Personenbezug. */
    const res = mockRes();
    await handleErrors(
      mockReq({
        errorMessage: "read_failed",
        phase: "image-read",
        msSeitAuswahl: 1834,
        zweiterLeseweg: "NotReadableError" + "x".repeat(100),
      }),
      res
    );
    expect(res.statusCode).toBe(204);
    const logged = loggedPayload();
    expect(logged.msSeitAuswahl).toBe(1834);
    expect(logged.zweiterLeseweg).toHaveLength(40);
    expect(logged.zweiterLeseweg.startsWith("NotReadableError")).toBe(true);
  });

  test("Lesefehler-Diagnose mit falschem Typ wird verworfen", async () => {
    const res = mockRes();
    await handleErrors(mockReq({ errorMessage: "x", phase: "p", msSeitAuswahl: "1834", zweiterLeseweg: 7 }), res);
    expect(res.statusCode).toBe(204);
    const logged = loggedPayload();
    expect(logged.msSeitAuswahl == null).toBe(true);
    expect(logged.zweiterLeseweg == null).toBe(true);
  });

  test("client.automatisiert als Text wird verworfen — nur boolesch zaehlt", async () => {
    const res = mockRes();
    await handleErrors(mockReq({ errorMessage: "x", phase: "p", client: { automatisiert: "true" } }), res);
    expect(res.statusCode).toBe(204);
    const logged = loggedPayload();
    expect(logged.client == null || !("automatisiert" in logged.client)).toBe(true);
  });

  test("verwirft Felder mit falschem Typ und kappt Ueberlaengen", async () => {
    const res = mockRes();
    await handleErrors(
      mockReq({
        errorMessage: "x",
        errorDetail: { evil: true },
        fileSizeKb: "nicht-numerisch",
        phase: "p".repeat(200),
      }),
      res
    );
    expect(res.statusCode).toBe(204);
    const logged = loggedPayload();
    expect(logged.errorDetail).toBeUndefined();
    expect(logged.fileSizeKb).toBeUndefined();
    expect(logged.phase).toHaveLength(50);
  });

  test("lehnt Nicht-POST ab", async () => {
    const res = mockRes();
    await handleErrors({ method: "GET", headers: {}, ip: "test-get" }, res);
    expect(res.statusCode).toBe(405);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
