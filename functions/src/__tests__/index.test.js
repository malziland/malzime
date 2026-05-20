// Tests for the analyze Cloud Function (handle-analyze.js).
// Pure Mistral-only pipeline since v1.6.0.

jest.mock("firebase-admin/app", () => ({
  initializeApp: jest.fn(),
}));

jest.mock("firebase-functions/v2/https", () => ({
  onRequest: jest.fn((opts, handler) => handler),
}));

jest.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: jest.fn((opts, handler) => handler),
}));

const mockCheckAndIncrement = jest.fn();
const mockIncrementTotals = jest.fn();
const mockGetStats = jest.fn();
const mockBoostLimit = jest.fn();
const mockResetCounter = jest.fn();
const mockGetMaintenanceStatus = jest.fn();
jest.mock("../counter", () => ({
  checkAndIncrement: mockCheckAndIncrement,
  incrementTotals: mockIncrementTotals,
  getStats: mockGetStats,
  boostLimit: mockBoostLimit,
  resetCounter: mockResetCounter,
  getMaintenanceStatus: mockGetMaintenanceStatus,
}));

const mockNotifyLimitReached = jest.fn();
jest.mock("../notify", () => ({ notifyLimitReached: mockNotifyLimitReached }));

const mockMistralDescribeImage = jest.fn();
const mockMistralGenerateBothProfiles = jest.fn();
jest.mock("../mistral", () => ({
  describeImage: mockMistralDescribeImage,
  generateBothProfiles: mockMistralGenerateBothProfiles,
}));

const mockClassifyDescription = jest.fn();
const mockBuildAnimalProfiles = jest.fn();
jest.mock("../animal", () => ({
  classifyDescription: mockClassifyDescription,
  buildAnimalProfiles: mockBuildAnimalProfiles,
}));

const mockBuildPrivacyRisks = jest.fn();
const mockExtractVisibleText = jest.fn();
jest.mock("../privacy", () => ({
  buildPrivacyRisks: mockBuildPrivacyRisks,
  extractVisibleText: mockExtractVisibleText,
}));

const mockCheckRateLimit = jest.fn();
const mockGetClientIp = jest.fn();
jest.mock("../middleware", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));

const mockParseMultipart = jest.fn();
const mockParseJsonBody = jest.fn();
jest.mock("../upload", () => ({
  parseMultipart: mockParseMultipart,
  parseJsonBody: mockParseJsonBody,
}));

// Load the handler after mocking
const { analyze } = require("../index");

/* SEC-009: Gültiger JPEG-Header für Magic-Byte-Check */
const VALID_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const VALID_JPEG_B64 = VALID_JPEG.toString("base64");

const VALID_PROFILE = {
  categories: { age: { label: "Age", value: "25", confidence: 0.8 } },
  ad_targeting: ["Brand"],
  manipulation_triggers: ["Trigger"],
  profileText: "Du bist...",
};

function mockReq(overrides = {}) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {},
    ip: "127.0.0.1",
    ...overrides,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status: jest.fn(function (code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function (data) {
      this.body = data;
    }),
  };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetClientIp.mockReturnValue("127.0.0.1");
  mockCheckRateLimit.mockReturnValue(true);
  mockBuildPrivacyRisks.mockReturnValue([]);
  mockExtractVisibleText.mockReturnValue("");
  mockGetMaintenanceStatus.mockResolvedValue({ enabled: false, message: "" });
  mockCheckAndIncrement.mockResolvedValue({ allowed: true, count: 1, limit: 500 });
  mockIncrementTotals.mockResolvedValue();
  mockNotifyLimitReached.mockResolvedValue();
  /* Default: kein Tier, Mensch erkannt — normaler Profil-Pfad */
  mockClassifyDescription.mockReturnValue({
    subject: "HUMAN",
    hasPerson: true,
    hasAnimal: false,
    animalType: null,
  });
});

describe("analyze handler — request validation", () => {
  test("rejects non-POST requests with 405", async () => {
    const req = mockReq({ method: "GET" });
    const res = mockRes();
    await analyze(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.body.error).toBe("Method not allowed");
  });

  test("returns 429 when rate limited", async () => {
    mockCheckRateLimit.mockReturnValue(false);
    mockParseJsonBody.mockReturnValue({ imageBase64: "AAAA" });
    const res = mockRes();
    await analyze(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.body.error).toBe("Rate limit exceeded");
  });

  test("returns 403 when honeypot is filled", async () => {
    mockParseJsonBody.mockReturnValue({
      website: "i-am-a-bot",
      imageBase64: VALID_JPEG_B64,
      mimeType: "image/jpeg",
    });
    const res = mockRes();
    await analyze(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body.error).toBe("Forbidden");
  });

  test("returns 400 when no image provided", async () => {
    mockParseJsonBody.mockReturnValue({});
    const res = mockRes();
    await analyze(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.error).toBe("Missing image");
  });

  test("returns 400 for invalid MIME type", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "application/pdf" });
    const res = mockRes();
    await analyze(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.error).toContain("Invalid file type");
  });

  test("returns 413 for oversized base64 input", async () => {
    const huge = "A".repeat(40 * 1024 * 1024);
    mockParseJsonBody.mockReturnValue({ imageBase64: huge, mimeType: "image/jpeg" });
    const res = mockRes();
    await analyze(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.body.error).toBe("File too large");
  });

  test("returns 400 for invalid base64 characters (BUG-013)", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: "!!!*&^%$@", mimeType: "image/jpeg" });
    const res = mockRes();
    await analyze(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.error).toBe("Invalid image data");
  });

  test("returns 400 when magic bytes don't match any image format (SEC-009)", async () => {
    const fakeBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    mockParseJsonBody.mockReturnValue({ imageBase64: fakeBuffer.toString("base64"), mimeType: "image/jpeg" });
    const res = mockRes();
    await analyze(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.error).toBe("Invalid image data");
  });

  test("accepts valid MIME types: jpeg, png, webp, gif", async () => {
    const mimeBuffers = {
      "image/jpeg": Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      "image/png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      "image/webp": Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBP", "ascii")]),
      "image/gif": Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]),
    };
    for (const [mime, buffer] of Object.entries(mimeBuffers)) {
      jest.clearAllMocks();
      mockGetClientIp.mockReturnValue("127.0.0.1");
      mockCheckRateLimit.mockReturnValue(true);
      mockBuildPrivacyRisks.mockReturnValue([]);
      mockExtractVisibleText.mockReturnValue("");
      mockGetMaintenanceStatus.mockResolvedValue({ enabled: false, message: "" });
      mockCheckAndIncrement.mockResolvedValue({ allowed: true, count: 1, limit: 500 });
      mockClassifyDescription.mockReturnValue({
        subject: "HUMAN",
        hasPerson: true,
        hasAnimal: false,
        animalType: null,
      });
      mockMistralDescribeImage.mockResolvedValue("SUBJECT: HUMAN\n\nA person.");
      mockMistralGenerateBothProfiles.mockResolvedValue({ normal: VALID_PROFILE, boost: VALID_PROFILE });
      mockParseJsonBody.mockReturnValue({ imageBase64: buffer.toString("base64"), mimeType: mime });

      const res = mockRes();
      await analyze(mockReq(), res);
      expect(res.statusCode).toBe(200);
    }
  });
});

describe("analyze handler — animal Easter-Egg flow", () => {
  test("ANIMAL_ONLY subject from Mistral → animal Easter-Egg profile", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: ANIMAL_ONLY\n\nEin Hund im Park.");
    mockClassifyDescription.mockReturnValue({
      subject: "ANIMAL_ONLY",
      hasPerson: false,
      hasAnimal: true,
      animalType: "dog",
    });
    mockBuildAnimalProfiles.mockReturnValue({
      normalProfile: { ...VALID_PROFILE, mode: "animal-normal" },
      boostProfile: { ...VALID_PROFILE, mode: "animal-boost" },
    });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(mockBuildAnimalProfiles).toHaveBeenCalledWith("dog", expect.any(String));
    expect(mockMistralGenerateBothProfiles).not.toHaveBeenCalled();
    expect(res.body.meta.mode).toBe("animal");
  });

  test("MIXED subject (person + animal) → normal profile path, NOT Easter-Egg", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: MIXED\n\nFrau mit Hund.");
    mockClassifyDescription.mockReturnValue({
      subject: "MIXED",
      hasPerson: true,
      hasAnimal: true,
      animalType: null,
    });
    mockMistralGenerateBothProfiles.mockResolvedValue({ normal: VALID_PROFILE, boost: VALID_PROFILE });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(mockBuildAnimalProfiles).not.toHaveBeenCalled();
    expect(mockMistralGenerateBothProfiles).toHaveBeenCalled();
    expect(res.body.meta.mode).toBe("multimodal");
  });

  test("animal profile flow includes privacy risks (license plate in background)", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: ANIMAL_ONLY\n\nEin Hund.\n\nSichtbarer Text: LL-AB 1234");
    mockExtractVisibleText.mockReturnValue("LL-AB 1234");
    mockBuildPrivacyRisks.mockReturnValue(["privacy.licensePlate"]);
    mockClassifyDescription.mockReturnValue({
      subject: "ANIMAL_ONLY",
      hasPerson: false,
      hasAnimal: true,
      animalType: "dog",
    });
    mockBuildAnimalProfiles.mockReturnValue({
      normalProfile: VALID_PROFILE,
      boostProfile: VALID_PROFILE,
    });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(res.body.privacyRisks).toEqual(["privacy.licensePlate"]);
    expect(res.body.meta.mode).toBe("animal");
  });

  test("uses 'generic' animal type when classifyDescription returns null animalType", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: ANIMAL_ONLY\n\nEin Wesen.");
    mockClassifyDescription.mockReturnValue({
      subject: "ANIMAL_ONLY",
      hasPerson: false,
      hasAnimal: true,
      animalType: null,
    });
    mockBuildAnimalProfiles.mockReturnValue({
      normalProfile: VALID_PROFILE,
      boostProfile: VALID_PROFILE,
    });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(mockBuildAnimalProfiles).toHaveBeenCalledWith("generic", expect.any(String));
  });
});

describe("analyze handler — multimodal profile flow", () => {
  test("HUMAN subject → Mistral profile generation runs", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: HUMAN\n\nEine Person.");
    mockMistralGenerateBothProfiles.mockResolvedValue({ normal: VALID_PROFILE, boost: VALID_PROFILE });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(mockMistralDescribeImage).toHaveBeenCalled();
    expect(mockMistralGenerateBothProfiles).toHaveBeenCalled();
    expect(res.body.profiles.normal.categories).toBeDefined();
    expect(res.body.profiles.boost.categories).toBeDefined();
    expect(res.body.meta.mode).toBe("multimodal");
    expect(res.body.meta.subject).toBe("HUMAN");
  });

  test("OTHER subject (landscape/objects) also runs normal profile path", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: OTHER\n\nEin Sonnenuntergang.");
    mockClassifyDescription.mockReturnValue({
      subject: "OTHER",
      hasPerson: false,
      hasAnimal: false,
      animalType: null,
    });
    mockMistralGenerateBothProfiles.mockResolvedValue({ normal: VALID_PROFILE, boost: VALID_PROFILE });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(mockMistralGenerateBothProfiles).toHaveBeenCalled();
    expect(res.body.meta.mode).toBe("multimodal");
  });

  test("returns full structured response with categories, ad_targeting, manipulation_triggers, profileText", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: HUMAN\n\nPerson.");
    mockMistralGenerateBothProfiles.mockResolvedValue({ normal: VALID_PROFILE, boost: VALID_PROFILE });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(res.body.profiles.normal).toHaveProperty("categories");
    expect(res.body.profiles.normal).toHaveProperty("ad_targeting");
    expect(res.body.profiles.normal).toHaveProperty("manipulation_triggers");
    expect(res.body.profiles.normal).toHaveProperty("profileText");
    expect(res.body.profiles.boost).toHaveProperty("categories");
  });
});

describe("analyze handler — blocked flows", () => {
  test("Mistral describe returns null → blocked.safetyFilter", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    mockMistralDescribeImage.mockResolvedValue(null);

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(res.body.profiles).toBeNull();
    expect(res.body.blockedReason).toBe("blocked.safetyFilter");
    expect(res.body.meta.mode).toBe("blocked");
  });

  test("Mistral describe throws → blocked.apiError", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    mockMistralDescribeImage.mockRejectedValue(new Error("network down"));

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(res.body.profiles).toBeNull();
    expect(res.body.blockedReason).toBe("blocked.apiError");
  });

  test("rate_limit error from Mistral → blocked.overloaded", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    const err = new Error("Mistral 429 rate limited");
    err.code = "rate_limit";
    mockMistralDescribeImage.mockRejectedValue(err);

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(res.body.profiles).toBeNull();
    expect(res.body.blockedReason).toBe("blocked.overloaded");
  });

  test("Mistral profile fails (returns null/null) → blocked.profileBlocked", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: HUMAN\n\nText.");
    mockMistralGenerateBothProfiles.mockResolvedValue({ normal: null, boost: null });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(res.body.profiles).toBeNull();
    expect(res.body.blockedReason).toBe("blocked.profileBlocked");
  });
});

describe("analyze handler — EXIF + privacy handling", () => {
  test("passes clientExif (make/model) through to response", async () => {
    mockParseJsonBody.mockReturnValue({
      imageBase64: VALID_JPEG_B64,
      mimeType: "image/jpeg",
      exif: { make: "Apple", model: "iPhone 15 Pro" },
    });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: HUMAN\n\nPerson.");
    mockMistralGenerateBothProfiles.mockResolvedValue({ normal: VALID_PROFILE, boost: VALID_PROFILE });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(res.body.exif).toEqual({ make: "Apple", model: "iPhone 15 Pro" });
  });

  test("strips unknown keys from clientExif (SEC-006)", async () => {
    mockParseJsonBody.mockReturnValue({
      imageBase64: VALID_JPEG_B64,
      mimeType: "image/jpeg",
      exif: { make: "Canon", evil: "<script>alert(1)</script>", gps: { lat: 1, lng: 2 } },
    });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: HUMAN\n\nPerson.");
    mockMistralGenerateBothProfiles.mockResolvedValue({ normal: VALID_PROFILE, boost: VALID_PROFILE });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(res.body.exif.make).toBe("Canon");
    expect(res.body.exif.evil).toBeUndefined();
    expect(res.body.exif.gps).toBeUndefined();
  });

  test("truncates long EXIF values (SEC-006)", async () => {
    const veryLong = "A".repeat(500);
    mockParseJsonBody.mockReturnValue({
      imageBase64: VALID_JPEG_B64,
      mimeType: "image/jpeg",
      exif: { make: veryLong },
    });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: HUMAN\n\nPerson.");
    mockMistralGenerateBothProfiles.mockResolvedValue({ normal: VALID_PROFILE, boost: VALID_PROFILE });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(res.body.exif.make.length).toBe(100);
  });

  test("privacy risks from visible text are included in response", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: HUMAN\n\nText.\n\nSichtbarer Text: Schule");
    mockExtractVisibleText.mockReturnValue("Schule");
    mockBuildPrivacyRisks.mockReturnValue(["privacy.address"]);
    mockMistralGenerateBothProfiles.mockResolvedValue({ normal: VALID_PROFILE, boost: VALID_PROFILE });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(res.body.privacyRisks).toEqual(["privacy.address"]);
  });
});

describe("analyze handler — hourly counter integration", () => {
  test("honeypot request does NOT call checkAndIncrement (BUG-001)", async () => {
    mockParseJsonBody.mockReturnValue({ website: "bot", imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    await analyze(mockReq(), mockRes());
    expect(mockCheckAndIncrement).not.toHaveBeenCalled();
  });

  test("missing image does NOT call checkAndIncrement (BUG-001)", async () => {
    mockParseJsonBody.mockReturnValue({});
    await analyze(mockReq(), mockRes());
    expect(mockCheckAndIncrement).not.toHaveBeenCalled();
  });

  test("invalid magic bytes does NOT call checkAndIncrement (BUG-001)", async () => {
    mockParseJsonBody.mockReturnValue({
      imageBase64: Buffer.from([0, 0, 0, 0]).toString("base64"),
      mimeType: "image/jpeg",
    });
    await analyze(mockReq(), mockRes());
    expect(mockCheckAndIncrement).not.toHaveBeenCalled();
  });

  test("valid upload calls checkAndIncrement", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: HUMAN\n\nPerson.");
    mockMistralGenerateBothProfiles.mockResolvedValue({ normal: VALID_PROFILE, boost: VALID_PROFILE });
    await analyze(mockReq(), mockRes());
    expect(mockCheckAndIncrement).toHaveBeenCalled();
  });

  test("returns 429 with blocked:limit when hourly limit reached", async () => {
    mockCheckAndIncrement.mockResolvedValue({ allowed: false, retryAfterSeconds: 1800, count: 500, limit: 500 });
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.body.blocked).toBe("limit");
    expect(res.body.retryAfterSeconds).toBe(1800);
  });

  test("incrementTotals error does not break successful response", async () => {
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: HUMAN\n\nPerson.");
    mockMistralGenerateBothProfiles.mockResolvedValue({ normal: VALID_PROFILE, boost: VALID_PROFILE });
    mockIncrementTotals.mockRejectedValue(new Error("firestore down"));

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.profiles.normal).toBeDefined();
  });

  test("ntfy notification error does not prevent 429 response", async () => {
    mockCheckAndIncrement.mockResolvedValue({
      allowed: false,
      justReached: true,
      retryAfterSeconds: 1800,
      count: 500,
      limit: 500,
    });
    mockNotifyLimitReached.mockRejectedValue(new Error("ntfy unreachable"));
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(429);
  });
});

describe("analyze handler — maintenance mode", () => {
  test("returns 503 when maintenance mode is enabled", async () => {
    mockGetMaintenanceStatus.mockResolvedValue({ enabled: true, message: "Wartungsarbeiten" });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.body.maintenance).toBe(true);
    expect(res.body.message).toBe("Wartungsarbeiten");
  });

  test("proceeds normally when maintenance mode is disabled", async () => {
    mockGetMaintenanceStatus.mockResolvedValue({ enabled: false, message: "" });
    mockParseJsonBody.mockReturnValue({ imageBase64: VALID_JPEG_B64, mimeType: "image/jpeg" });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: HUMAN\n\nPerson.");
    mockMistralGenerateBothProfiles.mockResolvedValue({ normal: VALID_PROFILE, boost: VALID_PROFILE });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(res.statusCode).toBe(200);
  });
});

describe("analyze handler — multipart fallback", () => {
  test("falls back to multipart parsing when not JSON", async () => {
    mockParseJsonBody.mockReturnValue(null);
    mockParseMultipart.mockResolvedValue({
      file: { buffer: VALID_JPEG, mimeType: "image/jpeg", size: VALID_JPEG.length, filename: "x.jpg" },
      fields: {},
    });
    mockMistralDescribeImage.mockResolvedValue("SUBJECT: HUMAN\n\nPerson.");
    mockMistralGenerateBothProfiles.mockResolvedValue({ normal: VALID_PROFILE, boost: VALID_PROFILE });

    const res = mockRes();
    await analyze(mockReq(), res);

    expect(mockParseMultipart).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
});
