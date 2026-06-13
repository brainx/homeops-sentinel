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
