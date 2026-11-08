import { expect, test } from "@playwright/test";
import { fixtureInitialView, fixturePaymentRequestedView, fixtureFallbackView } from "../../../src/contracts/game-fixtures";

test("API transport retry keeps action identity and pending controls locked", async ({ page }, info) => {
  const errors: string[] = [];
  const bodies: unknown[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/game/sessions", route => route.fulfill({ json: { session: fixtureInitialView } }));
  await page.route("**/api/game/sessions/*/actions", async route => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "Please retry" }, requestId: "ui-test" } });
    return route.fulfill({ json: { session: fixtureFallbackView, result: { status: "duplicate", eventIds: [], opponentTurn: null } } });
  });
  await page.goto("/play?adapter=api");
  await page.getByLabel("Your reply").fill("I win");
  await page.getByRole("button", { name: "Send reply", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Please retry" })).toBeVisible();
  await page.getByRole("button", { name: "Retry request" }).click();
  await expect(page.getByText("Scripted fallback · live unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inspect request", exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  await page.screenshot({ path: info.outputPath("api-mocked-fallback.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("version conflict refetches and requires a reviewed new action", async ({ page }) => {
  let gets = 0;
  await page.route("**/api/game/sessions", route => route.fulfill({ json: { session: fixtureInitialView } }));
  await page.route("**/api/game/sessions/*", route => { gets++; return route.fulfill({ json: { session: fixturePaymentRequestedView } }); });
  await page.route("**/api/game/sessions/*/actions", route => route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT", message: "Changed", currentVersion: 4 }, requestId: "ui-test-conflict" } }));
  await page.goto("/play?adapter=api");
  await page.getByLabel("Your reply").fill("Hello");
  await page.getByRole("button", { name: "Send reply", exact: true }).click();
  await expect(page.getByText("The session changed. Review the refreshed state and choose your action again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry request" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Inspect request", exact: true })).toBeVisible();
  expect(gets).toBe(1);
});
