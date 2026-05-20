/* Tests für cloud-tasks.js — Wrapper um Google Cloud Tasks.
   Der CloudTasksClient wird durch eine Attrappe ersetzt; es werden keine
   echten GCP-Credentials und keine echte Queue benötigt. */

const tasks = require("../cloud-tasks");

afterEach(() => {
  tasks.setClientForTest(null);
  delete process.env.GCLOUD_PROJECT;
  delete process.env.GCP_PROJECT;
  delete process.env.QUEUE_INVOKER_SA;
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
