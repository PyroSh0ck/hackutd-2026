import { expect, test, type Page } from "@playwright/test";

/**
 * Practice UI against the real API + Neon test DB, with the LABELED test-only fixture observer, planner and
 * actor (E2E_TEST=1 + OBSERVER_MODEL_MODE=fixture). Proves the integrated controls and outcomes, not model
 * quality.
 */

async function sendMessage(page: Page, text: string) {
  const box = page.getByLabel("Message");
  await expect(box).toBeEnabled();
  await box.fill(text);
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/messages") && r.request().method() === "POST"), box.press("Enter")]);
}

test("question → answer → request card; share cancelled; verify → read result → reject and report", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/practice");
  await expect(page.getByText(/Hi, I'm Avery from Cedar Account Support/)).toBeVisible();
  await expect(page.getByText(/Simulation: a fictional practice exercise/)).toBeVisible();

  await sendMessage(page, "Who are you?");
  await expect(page.getByText(/Account Review team/)).toBeVisible();
  await sendMessage(page, "Sure, go on.");
  await expect(page.getByRole("heading", { name: "Simulated request: share practice code" })).toBeVisible();
  await expect(page.getByText(/Fictional practice code: \d{6}/)).toBeVisible();

  // Cancelable confirmation: cancelling records nothing.
  await page.getByRole("button", { name: "Share practice code" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("simulated disclosure");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Simulated request: share practice code" })).toBeVisible();

  await page.getByRole("button", { name: "Verify independently" }).click();
  await expect(page.getByText(/not initiated by Cedar Mobile/)).toBeVisible();
  await expect(page.getByLabel("Message")).toBeDisabled();
  await page.getByRole("button", { name: "I have read this result" }).click();
  await expect(page.getByRole("heading", { name: "Your decision" })).toBeVisible();
  await page.getByRole("button", { name: "Reject and report" }).click();
  await expect(page.getByText(/Defense demonstrated/)).toBeVisible();
  await expect(page.getByLabel("Message")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("resume after refresh; share confirmed → simulated exposure", async ({ page }) => {
  await page.goto("/practice");
  await sendMessage(page, "Sure, go on.");
  await expect(page.getByRole("heading", { name: "Simulated request: share practice code" })).toBeVisible();
  await page.reload();
  await expect(page.getByText(/use the request card to share the practice code/)).toBeVisible();
  await page.getByRole("button", { name: "Share practice code" }).click();
  await page.getByRole("button", { name: "Share in simulation" }).click();
  await expect(page.getByText(/Simulated exposure/)).toBeVisible();
  await page.getByRole("button", { name: "Start a new practice" }).click();
  await expect(page.getByText(/Simulation · turn 0 of 12/)).toBeVisible();
});
