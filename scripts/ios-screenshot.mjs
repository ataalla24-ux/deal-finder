import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { webkit, devices } from "playwright";

const PORT = 4173;
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "artifacts", "ios");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("Local server did not start in time.");
}

async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const server = spawn(
    "python3",
    ["-m", "http.server", String(PORT), "--bind", HOST, "--directory", "docs"],
    { cwd: ROOT, stdio: "ignore" }
  );

  try {
    await waitForServer(`${BASE_URL}/index.html`);

    const browser = await webkit.launch();
    const profiles = [
      { name: "iphone-se", device: devices["iPhone SE"] },
      { name: "iphone-14", device: devices["iPhone 14"] },
    ];

    for (const profile of profiles) {
      const context = await browser.newContext({
        ...profile.device,
        locale: "de-AT",
      });
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      await page.screenshot({
        path: path.join(OUT_DIR, `${profile.name}-home.png`),
        fullPage: true,
      });
      await context.close();
    }

    await browser.close();
    console.log(`Screenshots written to ${OUT_DIR}`);
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
