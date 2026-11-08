import { expect, test } from "@playwright/test";

/** Agent lab against the real API + Neon test DB with the LABELED fixture models and AGENT_DEBUG=1. */
test("agent lab: chat on the left; each message's agent steps on the right", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/agent-lab");
  await expect(page.getByText(/Hi, I'm Avery from Cedar Account Support/)).toBeVisible();
  await expect(page.getByText("Send a message to see what each agent receives and returns.")).toBeVisible();

  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill("Who are you?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log", { name: "Chat thread" }).getByText(/Account Review team/)).toBeVisible();

  const trace = page.getByRole("region", { name: "Agent trace" });
  for (const title of [/Observer input \(conversation scope\)/, /observer → fixture-observer/, /Observer output: unclear · accepted/, /Eligible \(P3\): answer_identity/, /Planner input/, /planner → fixture-planner/, /Plan accepted/, /Actor input \(answer_identity, attempt 1\)/, /actor → fixture-actor/, /Actor draft valid · 1 call/, /Committed: message sent/]) {
    await expect(trace.getByText(title)).toBeVisible();
  }
  await expect(trace.getByText(/"identity_question"/).filter({ visible: true }).first()).toBeVisible(); // raw observer output is shown

  await box.fill("Yes, I'll send the code.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(trace.getByText(/Eligible \(P10\)|Wait \(/)).toBeVisible();
  // Selecting an earlier message shows that message's trace again.
  await page.getByRole("button", { name: "Who are you?" }).click();
  await expect(trace.getByText(/Eligible \(P3\): answer_identity/)).toBeVisible();
  expect(errors).toEqual([]);
});
