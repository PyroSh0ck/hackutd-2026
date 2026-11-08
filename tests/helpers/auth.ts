import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";

export async function registerTestUser(request: APIRequestContext) {
  const credentials = {
    name: "Test User",
    email: `test-${randomUUID()}@example.com`,
    password: `Test-${randomUUID()}!`,
  };

  const response = await request.post("/api/auth/sign-up/email", {
    headers: {
      Origin: "http://127.0.0.1:3100",
    },
    data: credentials,
  });

  expect(
    response.ok(),
    `Test signup failed with HTTP ${response.status()}`,
  ).toBeTruthy();
  return credentials;
}

/** Signs in through the real form. The app redirects to the home page after sign-in. */
export async function signInThroughUi(
  page: import("@playwright/test").Page,
  credentials: { email: string; password: string },
) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
}
