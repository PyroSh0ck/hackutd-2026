import { expect, test, type Page } from "@playwright/test";

/**
 * SCAMPER Magenta Modern UI (/scamper/*) against the real API + Neon test DB, with the LABELED test-only
 * fixture observer, planner and actor (E2E_TEST=1 + OBSERVER_MODEL_MODE=fixture). Proves the integrated
 * controls and outcomes, not model quality.
 */

async function sendMessage(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Message" });
  await expect(box).toBeEnabled();
  await box.fill(text);
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/messages") && r.request().method() === "POST"), box.press("Enter")]);
  await expect(box).toHaveValue("");
}

async function begin(page: Page) {
  await page.goto("/scamper/practice");
  await expect(page.getByRole("heading", { name: "Practice a real-world conversation." })).toBeVisible();
  await page.getByRole("button", { name: "Begin practice" }).click();
  await expect(page.getByText(/Hi, I'm Avery from Cedar Account Support/)).toBeVisible();
}

test("verification path: request card → official check → report → review → case history", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await begin(page);
  await expect(page.getByText(/Simulation: a fictional practice exercise/)).toBeVisible();

  await sendMessage(page, "Who are you?");
  await expect(page.getByRole("list", { name: "Conversation transcript" }).getByText(/Account Review team/)).toBeVisible();
  await sendMessage(page, "Sure, go on.");
  const card = page.getByRole("listitem", { name: "Simulated request" });
  await expect(card).toContainText(/Fictional practice code: \d{6}/);
  await expect(card).toContainText("Awaiting your choice");

  // Cancelable confirmation records nothing.
  await card.getByRole("button", { name: "Share practice code" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("simulated disclosure");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(card).toContainText("Awaiting your choice");

  // Opening the check is local; running it is the server event that pauses the conversation.
  await page.getByRole("button", { name: "Check official support" }).click();
  const dialog = page.getByRole("dialog", { name: "Official support check" });
  await expect(dialog).not.toContainText(/not initiated by Cedar Mobile/);
  await dialog.getByRole("button", { name: "Run check" }).click();
  await expect(dialog).toContainText(/not initiated by Cedar Mobile/);

  // Closing does not erase the result; the conversation stays paused.
  await dialog.getByRole("button", { name: "Close official support check" }).click();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeDisabled();
  await page.getByRole("button", { name: "Open official support check" }).click();
  await expect(dialog).toContainText(/not initiated by Cedar Mobile/);

  await dialog.getByRole("button", { name: "I have read this result" }).click();
  await expect(dialog.getByRole("heading", { name: "Your decision" })).toBeVisible();
  await dialog.getByRole("button", { name: "Report / block and end" }).click();
  await expect(dialog).toContainText("Defense demonstrated");
  await page.keyboard.press("Escape");

  await expect(page.getByRole("textbox", { name: "Message" })).toBeDisabled();
  await expect(card).not.toContainText("Awaiting your choice");
  await expect(card.getByRole("button", { name: "Share practice code" })).toHaveCount(0);

  await page.getByRole("link", { name: "See your review" }).click();
  await expect(page.getByRole("heading", { name: "Your practice review" })).toBeVisible();
  await expect(page.getByText("Reported and blocked the sender")).toBeVisible();

  // How this session worked: what actually ran, from stored audit records (no reasoning).
  await page.getByText("How this session worked").click();
  await expect(page.getByText("Training state")).toBeVisible();
  await expect(page.getByText(process.env.TRAINING_BACKEND === "spacetime" ? "SpacetimeDB module (authoritative)" : "Postgres")).toBeVisible();
  if (process.env.PLANNER_PROTOCOL === "tools") await expect(page.getByText("get_training_context").first()).toBeVisible();

  await page.getByRole("link", { name: "Case history" }).click();
  await expect(page.getByRole("heading", { name: "Case history" })).toBeVisible();
  await expect(page.getByText("Defense demonstrated").filter({ visible: true })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("simulated exposure path; resume after refresh; typing 'I accept' never submits", async ({ page }) => {
  await begin(page);
  await sendMessage(page, "Sure, go on.");
  const card = page.getByRole("listitem", { name: "Simulated request" });
  await expect(card).toContainText("Awaiting your choice");

  await page.reload();
  await expect(card).toContainText("Awaiting your choice");
  await sendMessage(page, "I accept");
  await expect(card).toContainText("Awaiting your choice");

  await card.getByRole("button", { name: "Share practice code" }).click();
  await page.getByRole("button", { name: "Share in simulation" }).click();
  await expect(page.getByText("Simulated exposure").first()).toBeVisible();
  await expect(card).toContainText("Shared in simulation");

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(/Turn 0 of 12/).first()).toBeAttached();
});

test("End practice ends the session as safely disengaged; Home summary counts it", async ({ page }) => {
  await begin(page);
  await page.getByRole("button", { name: "End practice" }).click();
  await expect(page.getByText("Safely disengaged").first()).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome to SCAMPER" })).toBeVisible();
  await expect(page.getByText("Completed sessions")).toBeVisible();
});

test("mobile: no horizontal overflow; practice details and menu are reachable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await begin(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.getByRole("button", { name: "Practice details" }).click();
  await expect(page.getByRole("dialog", { name: "Practice details" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("link", { name: "Resources" })).toBeVisible();
});

test("B06 (browser): verification resumes after a page reload without restarting the check", async ({ page }) => {
  await begin(page);
  await page.getByRole("button", { name: "Check official support" }).click();
  await page.getByRole("dialog", { name: "Official support check" }).getByRole("button", { name: "Run check" }).click();
  await expect(page.getByRole("dialog", { name: "Official support check" })).toContainText(/not initiated by Cedar Mobile/);
  await page.reload();
  const dialog = page.getByRole("dialog", { name: "Official support check" });
  await expect(dialog).toContainText(/not initiated by Cedar Mobile/);
  await dialog.getByRole("button", { name: "I have read this result" }).click();
  await expect(dialog.getByRole("heading", { name: "Your decision" })).toBeVisible();
  await dialog.getByRole("button", { name: "Report / block and end" }).click();
  await expect(dialog).toContainText("Defense demonstrated");
});

test("B20: history is server-side; it survives clearing browser storage while the player cookie persists", async ({ page }) => {
  await begin(page);
  await page.getByRole("button", { name: "End practice" }).click();
  await expect(page.getByText("Safely disengaged").first()).toBeVisible();
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/scamper/history");
  await expect(page.getByText("Safely disengaged").filter({ visible: true }).first()).toBeVisible();
});

test("stop while generation is pending: End practice wins; the late reply is never shown", async ({ page }) => {
  await begin(page);
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill("[[slow]] Who are you?");
  const sent = page.waitForResponse((r) => r.url().endsWith("/messages") && r.request().method() === "POST");
  const startedAt = Date.now();
  await box.press("Enter");
  // Typing dots are only shown while the real request is running.
  await expect(page.getByText(/is replying/)).toBeAttached();
  // Let the observer finish so the stop lands while the (held) planner/actor generation is in flight.
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "End practice" }).click();
  await expect(page.getByText("Safely disengaged").first()).toBeVisible();
  await sent; // the held generation finishes after the stop
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(3500); // the hold really happened (planner was running)
  await page.waitForTimeout(500);
  const transcript = page.getByRole("list", { name: "Conversation transcript" });
  await expect(transcript.getByText(/Avery with Cedar Account Support/)).toHaveCount(0); // no late answer
  await expect(page.getByText("Safely disengaged").first()).toBeVisible();
  // And after a reload the server state agrees: ended, opening message only from the opponent.
  await page.reload();
  await expect(page.getByRole("button", { name: "Review your last practice" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Review your last practice" })).toBeVisible();
});
