import { expect, test } from "@playwright/test";

test("restore-test drafts survive background state refreshes", async ({ page }) => {
  const backupName = `Polling draft ${Date.now().toString(36)}`;

  await page.goto("/");
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(backupName);
  await page.getByRole("button", { name: "Add backup", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Backup tracker created");

  const backupCard = page.locator(".backup-card").filter({ hasText: backupName });
  await backupCard.getByRole("button", { name: "Restore test", exact: true }).click();
  const target = page.getByLabel("Restore target", { exact: true });
  const evidence = page.locator(".restore-test-form textarea");
  await target.fill("Unsaved restore target");
  await evidence.fill("Unsaved restore evidence");
  await expect(target).toHaveValue("Unsaved restore target");
  await expect(evidence).toHaveValue("Unsaved restore evidence");

  await page.waitForTimeout(8_500);

  await expect(target).toHaveValue("Unsaved restore target");
  await expect(evidence).toHaveValue("Unsaved restore evidence");
});

test("failed actions preserve form input", async ({ page }) => {
  const rejectedUrl = "http://127.0.0.1:4747/rejected-hook";

  await page.goto("/");
  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  const webhook = page.getByLabel("Webhook URL", { exact: true });
  await webhook.fill(rejectedUrl);
  await page.getByRole("button", { name: "Save alerts", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText("target host is blocked");
  await expect(webhook).toHaveValue(rejectedUrl);
});

test("failed test-alert delivery is announced as an error", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await page
    .getByLabel("Webhook URL", { exact: true })
    .fill("https://example.invalid/homeops-alert-regression");
  await page.getByRole("button", { name: "Save alerts", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Alert settings saved");

  await page.getByRole("button", { name: "Test alert", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText(
    /ENOTFOUND|did not resolve|delivery failed/i,
    {
      timeout: 12_000
    }
  );
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("new monitors inherit the configured default check interval", async ({ page }) => {
  const monitorName = `Interval probe ${Date.now().toString(36)}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Default check interval in seconds", { exact: true }).fill("777");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Settings saved");

  await page.getByRole("button", { name: "Monitors", exact: true }).click();

  const createInterval = page.getByLabel("Interval in seconds", { exact: true }).first();
  await expect(createInterval).toHaveValue("777");

  await page.getByLabel("Name", { exact: true }).fill(monitorName);
  await page.getByLabel("URL", { exact: true }).fill("http://127.0.0.1:4761/api/health");
  await createInterval.fill("888");
  await page.getByRole("button", { name: "Create monitor", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Monitor created");

  await page.getByRole("button", { name: `Edit ${monitorName}`, exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit monitor" }).getByLabel("Interval in seconds")
  ).toHaveValue("888");
});

test("failed monitor edits remain open with the draft intact", async ({ page }) => {
  const monitorName = `Rejected edit ${Date.now().toString(36)}`;
  const draftName = `${monitorName} draft`;
  await page.goto("/");
  await page.getByRole("button", { name: "Monitors", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(monitorName);
  await page.getByLabel("URL", { exact: true }).fill("http://127.0.0.1:4761/api/health");
  await page.getByRole("button", { name: "Create monitor", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Monitor created");

  await page.getByRole("button", { name: `Edit ${monitorName}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit monitor" });
  const name = dialog.getByLabel("Name", { exact: true });
  await name.fill(draftName);
  await page.route("**/api/monitors/*", async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":"edit rejected"}'
      });
      return;
    }
    await route.continue();
  });

  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();

  await expect(dialog.getByRole("alert")).toContainText("Monitor update failed");
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue(draftName);
});

test("missing clipboard support reports copy unavailable", async ({ page }) => {
  const backupName = `Clipboard probe ${Date.now().toString(36)}`;
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "clipboard", {
      configurable: true,
      get: () => undefined
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(backupName);
  await page.getByRole("button", { name: "Add backup", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Backup tracker created");

  await page
    .getByRole("button", { name: `Create heartbeat token for ${backupName}`, exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Heartbeat token ready");
  await page.getByRole("button", { name: "Copy heartbeat token", exact: true }).click();

  await expect(page.getByText("Copy unavailable", { exact: true })).toBeVisible();
});
