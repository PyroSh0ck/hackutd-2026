import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { registerTestUser, signInThroughUi } from "../helpers/auth";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("[browser error]", error.message));
});

test("a user can register through the UI and lands on the home page", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Browser User");
  await page.getByLabel("Email", { exact: true }).fill(`browser-${randomUUID()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill(`Test-${randomUUID()}!`);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
});

test("an existing user can sign in", async ({ page, request }) => {
  await signInThroughUi(page, await registerTestUser(request));
  // The home page is now the Scamper start page (UI checkpoint 773aaf3).
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
  await expect(page.getByRole("heading", { level: 1, name: /Keep your garden\s*fund growing\./ })).toBeVisible();
});

test("wrong password shows an error and stays on sign-in", async ({ page, request }) => {
  const credentials = await registerTestUser(request);
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill("Wrong-password-1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("component CSS modules are applied in the real build", async ({ page }) => {
  // Guards against bundler config that strips CSS module scoping (jsdom cannot detect this).
  await page.goto("/sign-in");
  const button = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(button).toBeVisible();
  const style = await button.evaluate((el) => ({
    className: el.className,
    minHeight: getComputedStyle(el).minHeight,
    background: getComputedStyle(el).backgroundColor,
  }));
  expect(style.className).toMatch(/\S+_button/);
  expect(style.minHeight).not.toBe("auto");
  expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
});
