import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const primaryViews = [
  { nav: "Dashboard", heading: "HomeOps Sentinel" },
  { nav: "Monitors", heading: "Create monitor" },
  { nav: "Backups", heading: "Backup tracker" },
  { nav: "Alerts", heading: "Webhook alerts" },
  { nav: "Incidents", heading: "Record incident" },
  { nav: "Settings", heading: "Runtime settings" }
];

for (const view of primaryViews) {
  test(`${view.nav} view has no axe violations`, async ({ page }) => {
    await page.goto("/");

    if (view.nav !== "Dashboard") {
      await page.getByRole("button", { name: view.nav, exact: true }).click();
    }

    await expect(page.getByRole("heading", { name: view.heading, exact: true })).toBeVisible();

    const results = await new AxeBuilder({ page }).include("main").analyze();
    const blockingViolations = results.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact || "")
    );
    expect(blockingViolations).toEqual([]);
  });
}

test("monitor editor moves, contains, and restores keyboard focus", async ({ page }) => {
  const monitorName = `Focus probe ${Date.now().toString(36)}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Monitors", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(monitorName);
  await page.getByLabel("URL", { exact: true }).fill("http://127.0.0.1:4761/api/health");
  await page.getByRole("button", { name: "Create monitor", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Monitor created");

  const editButton = page.getByRole("button", { name: `Edit ${monitorName}`, exact: true });
  await editButton.click();
  const dialog = page.getByRole("dialog", { name: "Edit monitor" });
  const closeButton = dialog.getByRole("button", { name: "Close editor", exact: true });
  const saveButton = dialog.getByRole("button", { name: "Save changes", exact: true });

  await expect(dialog.getByLabel("Name", { exact: true })).toBeFocused();
  await expect(page.locator(".app-shell")).toHaveAttribute("inert", "");

  await saveButton.focus();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();

  const results = await new AxeBuilder({ page }).include("[role='dialog']").analyze();
  const blockingViolations = results.violations.filter((violation) =>
    ["critical", "serious"].includes(violation.impact || "")
  );
  expect(blockingViolations).toEqual([]);

  await closeButton.click();
  await expect(dialog).toHaveCount(0);
  await expect(editButton).toBeFocused();
  await expect(page.locator(".app-shell")).not.toHaveAttribute("inert", "");
});
