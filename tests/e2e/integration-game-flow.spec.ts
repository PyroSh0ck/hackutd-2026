import { expect, test, type Page } from "@playwright/test";
import { SessionResponseSchema, type PlayerView } from "@/contracts/game";

/**
 * E19/E21 integration: the real UI against the real API + Neon test DB (no network interception).
 * No MODEL_* credentials in the test server, so the live-requested session runs the labeled scripted
 * fallback. This proves the integrated flow, not live-model acceptance (see `pnpm game:smoke`).
 */

async function sessionFrom(page: Page, trigger: () => Promise<unknown>, pathEnd: RegExp): Promise<PlayerView> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && pathEnd.test(new URL(r.url()).pathname)),
    trigger(),
  ]);
  expect(response.ok()).toBe(true);
  return SessionResponseSchema.parse(await response.json()).session;
}

async function serverView(page: Page, sessionId: string): Promise<PlayerView> {
  const response = await page.request.get(`/api/game/sessions/${sessionId}`);
  expect(response.status()).toBe(200);
  return SessionResponseSchema.parse(await response.json()).session;
}

test("E19 play → loss → replay → fork → verify + reject → protected; original intact", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const created = await sessionFrom(page, () => page.goto("/play?adapter=api"), /\/api\/game\/sessions$/);
  await expect(page.getByLabel("Your reply")).toBeEnabled();

  // Loss path.
  await page.getByLabel("Your reply").fill("Is my account okay? What should I do?");
  await page.getByRole("button", { name: "Send reply", exact: true }).click();
  await expect(page.getByRole("button", { name: "Inspect request", exact: true })).toBeEnabled();
  // E21: fallback is labeled everywhere it appears.
  await expect(page.getByText("Scripted fallback · live unavailable")).toBeVisible();
  await expect(page.getByText("Request from scripted fallback")).toBeVisible();
  await page.getByRole("button", { name: "Inspect request", exact: true }).click();
  await expect(page.getByText("External account ••••8812", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Approve transfer…" }).click();
  await page.getByRole("button", { name: "Confirm approval" }).click();
  await expect(page.getByText("500 credits lost", { exact: true })).toBeVisible();
  await expect(page.getByText("1,000 credits", { exact: true }).first()).toBeVisible();

  const lossView = await serverView(page, created.sessionId);
  expect(lossView.outcome?.kind).toBe("loss");
  expect(lossView.bank.balance).toBe(1000);

  await page.getByRole("button", { name: "Read your debrief" }).click();
  await expect(page.getByText(/^\d+ \/ 100$/)).toBeVisible();
  await page.getByRole("button", { name: "Replay the evidence", exact: true }).click();
  await expect(page.getByText("Server reconstruction matches the saved state.")).toBeVisible();
  await expect(page.getByText("· Decisive moment", { exact: false })).toBeVisible();

  // Fork at the predefined checkpoint.
  const fork = await sessionFrom(page, () => page.getByRole("button", { name: "Retry before the payment decision" }).click(), /\/fork$/);
  expect(fork.sessionId).not.toBe(created.sessionId);
  expect(fork.lineage.parentSessionId).toBe(created.sessionId);
  await expect(page.getByText("Checkpoint practice · separate attempt")).toBeVisible();
  await expect(page.getByText("1,500 credits", { exact: true }).first()).toBeVisible();

  // Safer decision: verify independently, then reject every request.
  await page.getByRole("button", { name: "Verify through official line" }).click();
  await expect(page.getByText("Verified through trusted contact", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reject request", exact: true }).click();
  // The scripted opponent adapts with a second, smaller request; reject it too.
  await expect(page.getByRole("button", { name: "Reject request", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Reject request", exact: true }).click();
  await expect(page.getByText("Your garden fund is safe.")).toBeVisible();
  await expect(page.getByText("No funds lost", { exact: true })).toBeVisible();

  const protectedView = await serverView(page, fork.sessionId);
  expect(protectedView.outcome?.kind).toBe("protected");
  expect(protectedView.bank.balance).toBe(1500);
  await page.getByRole("button", { name: "Read your debrief" }).click();
  await expect(page.getByText("Coached practice · score belongs to this branch")).toBeVisible();

  // Original run is untouched by the branch.
  const originalAfter = await serverView(page, created.sessionId);
  expect(originalAfter.version).toBe(lossView.version);
  expect(originalAfter.lastSequence).toBe(lossView.lastSequence);
  expect(originalAfter.outcome?.kind).toBe("loss");
  expect(originalAfter.bank.balance).toBe(1000);

  expect(errors).toEqual([]);
});
