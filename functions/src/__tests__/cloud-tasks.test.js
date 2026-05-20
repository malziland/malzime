/* Tests für cloud-tasks.js — Wrapper um Google Cloud Tasks.
   Der CloudTasksClient wird durch eine Attrappe ersetzt; es werden keine
   echten GCP-Credentials und keine echte Queue benötigt. */

const tasks = require("../cloud-tasks");

afterEach(() => {
  tasks.setClientForTest(null);
  delete process.env.GCLOUD_PROJECT;
  delete process.env.GCP_PROJECT;
  delete process.env.QUEUE_INVOKER_SA;
  delete process.env.QUEUE_LOCAL;
  delete process.env.QUEUE_LOCAL_PROCESS_URL;
  delete process.env.QUEUE_LOCAL_CONCURRENCY;
});

describe("processJobUrl / invokerServiceAccount", () => {
  test("baut die Worker-URL aus Region und Projekt", () => {
    process.env.GCLOUD_PROJECT = "malzime";
    expect(tasks.processJobUrl()).toBe("https://europe-west1-malzime.cloudfunctions.net/processJob");
  });

  test("Default-Service-Account ist der App-Engine-SA des Projekts", () => {
    process.env.GCLOUD_PROJECT = "malzime";
    expect(tasks.invokerServiceAccount()).toBe("malzime@appspot.gserviceaccount.com");
  });

  test("QUEUE_INVOKER_SA überschreibt den Default-SA", () => {
    process.env.GCLOUD_PROJECT = "malzime";
    process.env.QUEUE_INVOKER_SA = "custom@malzime.iam.gserviceaccount.com";
    expect(tasks.invokerServiceAccount()).toBe("custom@malzime.iam.gserviceaccount.com");
  });
});

describe("enqueueJob", () => {
  test("erstellt einen Task mit jobId im Body, OIDC-Token und korrektem Queue-Pfad", async () => {
    process.env.GCLOUD_PROJECT = "malzime";
    let captured = null;
    tasks.setClientForTest({
      queuePath: (p, l, q) => `projects/${p}/locations/${l}/queues/${q}`,
      createTask: async (req) => {
        captured = req;
        return [{ name: "task-xyz" }];
      },
    });

    const name = await tasks.enqueueJob("job-77");

    expect(name).toBe("task-xyz");
    expect(captured.parent).toBe("projects/malzime/locations/europe-west1/queues/analyze-queue");
    const body = JSON.parse(Buffer.from(captured.task.httpRequest.body).toString());
    expect(body).toEqual({ jobId: "job-77" });
    expect(captured.task.httpRequest.httpMethod).toBe("POST");
    expect(captured.task.httpRequest.url).toContain("/processJob");
    expect(captured.task.httpRequest.oidcToken.serviceAccountEmail).toBe("malzime@appspot.gserviceaccount.com");
    expect(captured.task.httpRequest.oidcToken.audience).toBe(captured.task.httpRequest.url);
  });

  test("propagiert einen Fehler des Cloud-Tasks-Clients", async () => {
    process.env.GCLOUD_PROJECT = "malzime";
    tasks.setClientForTest({
      queuePath: () => "q",
      createTask: async () => {
        throw new Error("tasks unavailable");
      },
    });
    await expect(tasks.enqueueJob("job-1")).rejects.toThrow("tasks unavailable");
  });
});

describe("enqueueJob — Lokal-Modus (Emulator, QUEUE_LOCAL=1)", () => {
  test("stößt processJob lokal per HTTP an, ohne Cloud Tasks zu nutzen", async () => {
    process.env.QUEUE_LOCAL = "1";
    process.env.GCLOUD_PROJECT = "malzime";
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    const createTask = jest.fn();
    tasks.setClientForTest({ queuePath: () => "q", createTask });
    try {
      const name = await tasks.enqueueJob("job-77");
      expect(name).toBe("local-dispatch/job-77");
      expect(createTask).not.toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = global.fetch.mock.calls[0];
      expect(String(url)).toContain("/processJob");
      expect(JSON.parse(opts.body)).toEqual({ jobId: "job-77" });
    } finally {
      global.fetch = realFetch;
    }
  });

  test("QUEUE_LOCAL_PROCESS_URL überschreibt die Dispatch-URL", async () => {
    process.env.QUEUE_LOCAL = "1";
    process.env.QUEUE_LOCAL_PROCESS_URL = "http://127.0.0.1:9999/custom-process";
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    try {
      await tasks.enqueueJob("job-1");
      expect(String(global.fetch.mock.calls[0][0])).toBe("http://127.0.0.1:9999/custom-process");
    } finally {
      global.fetch = realFetch;
    }
  });
});
