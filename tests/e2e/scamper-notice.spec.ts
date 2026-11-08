import { expect, test, type Page } from "@playwright/test";

/**
 * Legitimate notice scenario (mobile-notice-01) in the /scamper UI, against the real API with labeled
 * fixture models. The session is created through the test-gated scenarioId override (E2E_TEST=1); players
 * never choose legitimate vs fraudulent.
 */
async function startNotice(page: Page) {
  // Establish the anonymous player cookie with ONE request first: concurrent first requests would each be
  // issued a different player, and the session would belong to whichever cookie the jar kept.
  expect((await page.request.get("/api/observer/progress")).status()).toBe(200);
  const res = await page.request.post("/api/observer/sessions", { data: { scenarioId: "mobile-notice-01" } });
  expect(res.status()).toBe(201);
  const { session } = (await res.json()) as { session: { sessionId: string; scenario: { id: string } } };
  expect(session.scenario.id).toBe("practice"); // opaque until review
  await page.goto("/scamper/resources"); // a same-origin page (storage) that starts no session of its own
  await page.evaluate((id) => window.localStorage.setItem("scamper.current", JSON.stringify(id)), session.sessionId);
  await page.goto("/scamper/practice");
  await expect(page.getByText(/new monthly statement/)).toBeVisible();
  return session.sessionId;
}

test("B10 (browser): reviewing the genuine notice through the trusted portal without the support check", async ({ page }) => {
  await startNotice(page);
  await expect(page.getByRole("listitem", { name: "Simulated request" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open account portal" }).click();
  const portal = page.getByRole("dialog", { name: "Account portal" });
  await expect(portal).toContainText("Practice monthly statement");
  await expect(portal).not.toContainText("No payment is due");
  await portal.getByRole("button", { name: "Open notice" }).click();
  await expect(portal).toContainText("No payment is due in this exercise.");
  await portal.getByRole("button", { name: "Mark notice reviewed" }).click();
  await expect(portal).toContainText("Reviewed");
  await portal.getByRole("button", { name: "Close account portal" }).click();
  await expect(page.getByText("Completed without the support check").first()).toBeVisible();
});

test("B09 (browser): official check → Proceed → review the notice = verified and completed", async ({ page }) => {
  await startNotice(page);
  await page.getByRole("button", { name: "Check official support" }).click();
  const check = page.getByRole("dialog", { name: "Official support check" });
  await check.getByRole("button", { name: "Run check" }).click();
  await expect(check).toContainText(/monthly-statement notice was issued/);
  await check.getByRole("button", { name: "I have read this result" }).click();
  await check.getByRole("button", { name: "Proceed (simulated)" }).click();
  await check.getByRole("button", { name: "Close official support check" }).click();
  await page.getByRole("button", { name: "Open account portal" }).click();
  const portal = page.getByRole("dialog", { name: "Account portal" });
  await portal.getByRole("button", { name: "Open notice" }).click();
  await portal.getByRole("button", { name: "Mark notice reviewed" }).click();
  await portal.getByRole("button", { name: "Close account portal" }).click();
  await expect(page.getByText("Verified and completed").first()).toBeVisible();
});

test("B11 (browser): reporting the genuine notice is recorded as declined, never as exposure", async ({ page }) => {
  await startNotice(page);
  await page.getByRole("button", { name: "Report / block and end" }).click();
  await expect(page.getByText("Genuine notice declined").first()).toBeVisible();
});

test("the public directory carries no scenario kinds and no clickable contacts", async ({ page }) => {
  await page.goto("/scamper");
  const dir = await page.request.get("/api/observer/reference-directory");
  expect(dir.status()).toBe(200);
  const text = await dir.text();
  expect(text).not.toMatch(/fraudulent|legitimate|https?:|mailto:|tel:/);
});
