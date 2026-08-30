"use strict";

/* Betriebswerte kommen seit 30.08.2026 aus Firestore; hier gestellt, damit
   der Test nicht das Protokoll des Satz-Ladens mitzaehlt. */
jest.mock("../betriebsprofil", () => ({
  geltendeWerte: async () => ({
    werte: { adressLimit: 500, adressfensterMs: 600000 },
    quelle: "firestore",
    profil: "test",
    grund: null,
  }),
}));

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
