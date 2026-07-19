import { expect, test } from "@playwright/test";

test("operator can configure readiness records and keep state after reload", async ({
  page,
  baseURL
}) => {
  const suffix = Date.now().toString(36);
  const monitorName = `Self health ${suffix}`;
  const renamedMonitorName = `Sentinel health ${suffix}`;
  const backupName = `Nightly backup ${suffix}`;
  const incidentTitle = `Router maintenance ${suffix}`;

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "HomeOps Sentinel", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Service checks", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Monitors", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create monitor", exact: true })).toBeVisible();
  await page.getByLabel("Name").fill(monitorName);
  await page.getByLabel("URL").fill(`${baseURL}/api/health`);
  await page.getByRole("button", { name: "Create monitor" }).click();
  await expect(page.getByRole("status")).toContainText("Monitor created");
  await expect(page.getByRole("cell", { name: monitorName, exact: true })).toBeVisible();

  await page.getByRole("button", { name: `Run ${monitorName}` }).click();
  await expect(page.getByRole("status")).toContainText("Monitor check completed");
  const monitorRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: monitorName, exact: true }) });
  await expect(monitorRow.getByText("Healthy")).toBeVisible();
  await expect(monitorRow.getByText(/\d+ms/)).toBeVisible();
  await expect(monitorRow.getByText("100%", { exact: true })).toBeVisible();
  await expect(monitorRow.getByText(/1 check · \d+ms avg/)).toBeVisible();

  await page.getByRole("button", { name: `Edit ${monitorName}` }).click();
  const monitorEditor = page.getByRole("dialog", { name: "Edit monitor" });
  await expect(monitorEditor).toBeVisible();
  await monitorEditor.getByLabel("Name").fill(renamedMonitorName);
  await monitorEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Monitor updated");
  await expect(page.getByRole("cell", { name: renamedMonitorName, exact: true })).toBeVisible();

  await page.getByRole("button", { name: `Pause ${renamedMonitorName}` }).click();
  await expect(page.getByRole("status")).toContainText("Monitor paused");
  const pausedMonitorRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: renamedMonitorName, exact: true }) });
  await expect(pausedMonitorRow.getByText("Paused", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Resume ${renamedMonitorName}` }).click();
  await expect(page.getByRole("status")).toContainText("Monitor resumed");

  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Backup tracker", exact: true })).toBeVisible();
  await page.getByLabel("Name").fill(backupName);
  await page.getByLabel("Expected interval in hours").fill("24");
  await page.getByLabel("Restore test cadence in days").fill("30");
  await page.getByLabel("Notes").fill("Primary NAS snapshot");
  await page.getByRole("button", { name: "Add backup" }).click();
  await expect(page.getByRole("status")).toContainText("Backup tracker created");
  await expect(page.getByText(backupName)).toBeVisible();

  await page.getByRole("button", { name: `Create heartbeat token for ${backupName}` }).click();
  await expect(page.getByRole("status")).toContainText("Heartbeat token ready");
  const token = await page.getByLabel("Bearer token").inputValue();
  expect(token).toMatch(/^hop_/);

  await page.getByRole("button", { name: "Restore test" }).click();
  await page.getByLabel("Last restore test date").fill("2026-06-13");
  await page.getByLabel("Restore target").fill("Staging restore dataset");
  await page.getByLabel("Evidence notes").fill("Restored sample service and verified checksum");
  await page.getByRole("button", { name: "Save restore test" }).click();
  await expect(page.getByRole("status")).toContainText("Restore test recorded");

  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Webhook alerts", exact: true })).toBeVisible();
  await page.getByLabel("Webhook URL").fill("https://example.com/hooks/homeops-e2e");
  await page.getByRole("button", { name: "Save alerts" }).click();
  await expect(page.getByRole("status")).toContainText("Alert settings saved");
  await page.getByRole("button", { name: "Test alert" }).click();
  await expect(page.getByRole("status")).toContainText("Alert test completed", {
    timeout: 12_000
  });

  await page.getByRole("button", { name: "Incidents", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Record incident", exact: true })).toBeVisible();
  await page.getByLabel("Title").fill(incidentTitle);
  await page.getByLabel("Severity").selectOption("warning");
  await page.getByLabel("Notes").fill("Firmware upgrade window completed");
  await page.getByRole("button", { name: "Save incident" }).click();
  await expect(page.getByRole("status")).toContainText("Incident recorded");
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByRole("status")).toContainText("Incident resolved");

  await page.reload();
  await expect(page.getByText(incidentTitle)).toBeVisible();

  await page.getByRole("button", { name: "Monitors", exact: true }).click();
  const persistedMonitor = page.getByRole("cell", { name: renamedMonitorName, exact: true });
  await expect(persistedMonitor).toBeVisible();
  const persistedMonitorRow = page.getByRole("row").filter({ has: persistedMonitor });
  await expect(persistedMonitorRow.getByText("100%", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await expect(page.getByText(backupName)).toBeVisible();
  await expect(page.getByLabel("Bearer token")).toHaveCount(0);
});
