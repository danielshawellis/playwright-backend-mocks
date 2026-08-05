import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { getFreePort, withProxy } from "../helpers.js";

const dashboardCli = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/dashboard/dist/cli.cjs",
);

async function waitForUrl(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}

async function withDashboard(
  proxyUrl: string,
  run: (dashboardUrl: string) => Promise<void>,
): Promise<void> {
  const port = await getFreePort();
  const child: ChildProcess = spawn(
    process.execPath,
    [dashboardCli, "--host", "127.0.0.1", "--port", String(port), "--proxy-url", proxyUrl],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    },
  );
  const dashboardUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForUrl(`${dashboardUrl}/health`);
    await run(dashboardUrl);
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2000);
    });
  }
}

test.describe("observability dashboard", () => {
  test("serves health, config, and SPA pointed at the proxy", async ({ request }) => {
    await withProxy({}, async (proxy) => {
      await withDashboard(proxy.url, async (dashboardUrl) => {
        const health = await request.get(`${dashboardUrl}/health`);
        expect(health.status()).toBe(200);
        expect(await health.json()).toMatchObject({
          ok: true,
          proxyUrl: proxy.url,
        });

        const config = await request.get(`${dashboardUrl}/config.json`);
        expect(await config.json()).toEqual({ proxyUrl: proxy.url });

        const page = await request.get(`${dashboardUrl}/`);
        expect(page.status()).toBe(200);
        expect(page.headers()["content-type"]).toMatch(/text\/html/);
        expect(await page.text()).toContain("Playwright Backend Mocks");
      });
    });
  });

  test("UI shows HTTP view chrome and auto-refresh control", async ({ page }) => {
    await withProxy({}, async (proxy) => {
      await withDashboard(proxy.url, async (dashboardUrl) => {
        await page.goto(dashboardUrl);
        await expect(page.getByRole("heading", { name: "Playwright Backend Mocks" })).toBeVisible();
        await expect(page.getByRole("button", { name: "HTTP" })).toBeVisible();
        await expect(page.getByRole("button", { name: "WebSockets" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Connections" })).toBeVisible();
        await expect(page.getByLabel("Auto-refresh")).toBeChecked();
        await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Download HAR" })).toBeVisible();

        await page.getByRole("button", { name: "WebSockets" }).click();
        await expect(page.getByText("No WebSocket connections yet")).toBeVisible();
        await expect(page.getByRole("link", { name: "Download HAR" })).toHaveCount(0);

        await page.getByRole("button", { name: "Connections" }).click();
        await expect(page.getByText("Node agents", { exact: true })).toBeVisible();
        await expect(page.getByText("Playwright workers", { exact: true })).toBeVisible();
      });
    });
  });
});
