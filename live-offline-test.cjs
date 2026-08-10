const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("https://malzi.me/", { waitUntil: "networkidle" });

  await page.locator('.demo-thumb[data-demo="cafe"]').click();
  console.log("Analyse gestartet (Demo-Bild angeklickt)");
  await page.waitForTimeout(6000);

  await ctx.setOffline(true);
  console.log("OFFLINE — wie ein gesperrtes Handy");
  await page.waitForTimeout(28000);
  const offlineStatus = (await page.locator("#status").textContent().catch(() => "")) || "";
  console.log("Status offline:", offlineStatus.trim().slice(0, 100) || "(leer)");

  const jobId = await page.evaluate(() => sessionStorage.getItem("malzime.queueJobId"));
  console.log("Job-Nummer noch gespeichert:", jobId ? "JA (" + jobId.slice(0, 8) + "…)" : "NEIN — verloren!");

  await ctx.setOffline(false);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  console.log("WIEDER ONLINE + zurueck im Vordergrund");

  let da = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(3000);
    da = await page.locator("#facts .cat-card").first().isVisible().catch(() => false);
    if (da) break;
  }
  const endStatus = (await page.locator("#status").textContent().catch(() => "")) || "";
  console.log("\n=== ERGEBNIS ERSCHIENEN:", da ? "JA" : "NEIN");
  console.log("Status am Ende:", endStatus.trim().slice(0, 120) || "(leer)");
  await page.screenshot({ path: "/tmp/live-offline.png" });
  await browser.close();
})();
