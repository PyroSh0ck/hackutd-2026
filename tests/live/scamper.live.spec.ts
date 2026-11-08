import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * OPT-IN LIVE browser checks (real models + the configured training backend) against an already running
 * server. Never part of `pnpm check`, `test:e2e` or `test:integration`. Run with `pnpm test:live` (see
 * playwright.live.config.ts). Requires LIVE_BASE_URL; refuses to run unless /api/ready reports live models
 * (modelConfigured=true, fixtureModels=false). LIVE_SCENARIO selects the suite for how the server is
 * configured: "fraud" (default; server PRACTICE_SCENARIOS=mobile-code-01) or "notice"
 * (PRACTICE_SCENARIOS=mobile-notice-01).
 *
 * Live replies vary, so the conversation continues with cooperative messages (at most MAX_TURNS) until the
 * request card appears, and a visible technical notice is answered with the user-facing "Retry reply"
 * control. Retries are counted and reported, never hidden. Each test uses a fresh browser context, i.e. a
 * new anonymous player; nothing is deleted. Logs contain timings, counts and outcomes only: no message text,
 * no credentials, no headers. A per-session summary is written to tmp/live-results/ (gitignored).
 */
const SCENARIO = process.env.LIVE_SCENARIO ?? "fraud";
const REPLY_MS = 120_000;
const MAX_TURNS = 9;
const COOPERATIVE = ["Who is this?", "Sure, go on.", "Okay, what do you need from me?", "Alright, go ahead.", "Fine, what's next?", "Okay.", "Go on.", "Sure.", "Alright."];

type Row = { path: string; outcome: string; userTurnsBeforeRequest: number | "n/a" | "not reached"; visibleRetries: number; sendErrors: number; turnMs: number[]; durationMs: number };
const rows: Row[] = [];
const log = (...a: unknown[]) => console.log(`[live ${new Date().toISOString().slice(11, 19)}]`, ...a);

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const ready = (await (await request.get("/api/ready")).json()) as Record<string, unknown>;
  log("readiness:", JSON.stringify(ready));
  expect(ready.fixtureModels, "fixture models are enabled on the target: this is not a live run").toBe(false);
  expect(ready.modelConfigured, "no live model configured on the target").toBe(true);
  expect(ready.backendReachable).toBe(true);
});

test.afterAll(() => {
  mkdirSync("tmp/live-results", { recursive: true });
  const file = `tmp/live-results/${SCENARIO}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify({ target: process.env.LIVE_BASE_URL, scenario: SCENARIO, rows }, null, 2));
  log(`results: ${file}`);
  for (const r of rows) log(JSON.stringify(r));
});

function tracker(path: string) {
  const row: Row = { path, outcome: "incomplete", userTurnsBeforeRequest: "not reached", visibleRetries: 0, sendErrors: 0, turnMs: [], durationMs: 0 };
  const started = Date.now();
  rows.push(row);
  return { row, done: (outcome: string) => ((row.outcome = outcome), (row.durationMs = Date.now() - started)) };
}

async function begin(page: Page, greeting: RegExp) {
  await page.goto("/scamper/practice");
  await page.getByRole("button", { name: "Begin practice" }).click();
  await expect(page.getByText(greeting).first()).toBeVisible({ timeout: 30_000 });
}

async function send(page: Page, row: Row, text: string) {
  const box = page.getByRole("textbox", { name: "Message" });
  await expect(box).toBeEnabled({ timeout: REPLY_MS });
  await box.fill(text);
  const t0 = Date.now();
  const res = page.waitForResponse((r) => r.url().endsWith("/messages") && r.request().method() === "POST", { timeout: REPLY_MS });
  await box.press("Enter");
  const status = (await res).status();
  if (status >= 400) row.sendErrors++;
  // The message is recorded first; the reply follows (turnStatus). Wait until the typing indicator clears.
  await expect(page.getByRole("list", { name: "Conversation transcript" }).getByText(/is replying/)).toHaveCount(0, { timeout: REPLY_MS });
  row.turnMs.push(Date.now() - t0);
  const retry = page.getByRole("button", { name: "Retry reply" });
  if (await retry.count()) {
    row.visibleRetries++;
    log(`${row.path}: technical notice shown; pressing Retry reply`);
    await Promise.all([page.waitForResponse((r) => r.url().endsWith("/retry") && r.request().method() === "POST", { timeout: REPLY_MS }).catch(() => null), retry.click()]);
  }
}

async function untilRequest(page: Page, row: Row) {
  const card = page.getByRole("listitem", { name: "Simulated request" });
  for (const [i, line] of COOPERATIVE.slice(0, MAX_TURNS).entries()) {
    await send(page, row, line);
    if (await card.count()) {
      row.userTurnsBeforeRequest = i + 1;
      return card;
    }
  }
  throw new Error(`request card never appeared within ${MAX_TURNS} cooperative turns`);
}

test("isolation: a separate browser context cannot read another anonymous player's session", async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  try {
    expect((await a.request.get("/api/observer/progress")).status()).toBe(200); // establish player A's cookie
    const created = await a.request.post("/api/observer/sessions", { data: {} });
    expect(created.status()).toBe(201);
    const { session } = (await created.json()) as { session: { sessionId: string } };
    expect((await a.request.get(`/api/observer/sessions/${session.sessionId}`)).status()).toBe(200);
    expect((await b.request.get(`/api/observer/sessions/${session.sessionId}`)).status()).toBe(404);
    expect((await b.request.post(`/api/observer/sessions/${session.sessionId}/events`, { data: { idempotencyKey: crypto.randomUUID(), type: "conversation_ended", requestId: null } })).status()).toBe(404);
    const list = (await (await b.request.get("/api/observer/sessions")).json()) as { sessions: { id: string }[] };
    expect(list.sessions.map((s) => s.id)).not.toContain(session.sessionId);
    log("isolation: player B gets 404 for player A's session and does not list it");
  } finally {
    await a.close();
    await b.close();
  }
});

test.describe("fraud scenario (mobile-code-01)", () => {
  test.skip(SCENARIO !== "fraud", "LIVE_SCENARIO is not fraud");
  const GREETING = /Cedar Account Support/;

  test("verification → reload mid-check → report → review shows backend and tool calls", async ({ page }) => {
    const t = tracker("verification");
    await begin(page, GREETING);
    await untilRequest(page, t.row);
    await page.getByRole("button", { name: "Check official support" }).click();
    const dialog = page.getByRole("dialog", { name: "Official support check" });
    await dialog.getByRole("button", { name: "Run check" }).click();
    await expect(dialog).toContainText(/not initiated by Cedar Mobile/);
    await page.reload();
    await expect(dialog).toContainText(/not initiated by Cedar Mobile/, { timeout: 30_000 }); // resumed, not restarted
    await expect(dialog.getByRole("button", { name: "Run check" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "I have read this result" }).click();
    await dialog.getByRole("button", { name: "Report / block and end" }).click();
    await expect(dialog).toContainText("Defense demonstrated");
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "See your review" }).click();
    await page.getByText("How this session worked").click();
    await expect(page.getByText("get_training_context").first()).toBeVisible();
    t.done("defense_demonstrated");
  });

  test("simulated exposure: reload with the card pending; typing acceptance does not submit", async ({ page }) => {
    const t = tracker("simulated exposure");
    await begin(page, GREETING);
    const card = await untilRequest(page, t.row);
    await page.reload();
    await expect(card).toContainText("Awaiting your choice", { timeout: 30_000 });
    await send(page, t.row, "I accept");
    await expect(card).toContainText("Awaiting your choice");
    await card.getByRole("button", { name: "Share practice code" }).click();
    await page.getByRole("button", { name: "Share in simulation" }).click();
    await expect(page.getByText("Simulated exposure").first()).toBeVisible();
    t.done("simulated_exposure");
  });

  test("T14: reload while a reply is generating (no End): the reply arrives once, no duplicate bubbles or cards", async ({ page }) => {
    const t = tracker("reload mid-turn");
    t.row.userTurnsBeforeRequest = "n/a";
    await begin(page, GREETING);
    const transcript = page.getByRole("list", { name: "Conversation transcript" });
    const box = page.getByRole("textbox", { name: "Message" });
    await box.fill("hey");
    const t0 = Date.now();
    await box.press("Enter");
    await expect(transcript.getByText("hey", { exact: true })).toHaveCount(1); // immediate bubble
    await expect(transcript.getByText(/is replying/)).toBeAttached({ timeout: 30_000 });
    const reloadedAt = Date.now();
    await page.reload();
    // The reloaded page must first show the persisted message (once) and recover the pending turn from the server.
    await expect(transcript.getByText("hey", { exact: true })).toHaveCount(1, { timeout: 30_000 });
    const recovered = await transcript.getByText(/is replying/).count();
    // It then resolves: a reply, a pause note, or the Retry reply control. Never silence.
    const reply = transcript.locator('li[data-role="assistant"]').filter({ hasNotText: /is replying/ });
    const settled = page.getByRole("button", { name: "Retry reply" }).or(page.getByRole("status").filter({ hasText: /waiting|couldn't be processed/ }));
    await expect(reply.nth(1).or(settled.first())).toBeVisible({ timeout: REPLY_MS });
    await expect(transcript.getByText(/is replying/)).toHaveCount(0, { timeout: REPLY_MS });
    t.row.turnMs.push(Date.now() - t0);
    const replies = await reply.count();
    const retry = await page.getByRole("button", { name: "Retry reply" }).count();
    log(`${t.row.path}: typing indicator recovered after reload: ${recovered > 0}; resolved ${Date.now() - reloadedAt} ms after reload; opponent messages ${replies}; retry control ${retry}`);
    await expect(transcript.getByText("hey", { exact: true })).toHaveCount(1);
    expect(await page.getByRole("listitem", { name: "Simulated request" }).count()).toBeLessThanOrEqual(1);
    t.done(retry ? "recoverable_error" : replies >= 2 ? "replied" : "paused");
  });

  test("End practice while a reply is generating: no late reply", async ({ page }) => {
    const t = tracker("stop while generating");
    t.row.userTurnsBeforeRequest = "n/a";
    await begin(page, GREETING);
    const transcript = page.getByRole("list", { name: "Conversation transcript" });
    const before = await transcript.getByRole("listitem").count();
    const box = page.getByRole("textbox", { name: "Message" });
    await box.fill("Who is this and why are you texting me?");
    const sent = page.waitForResponse((r) => r.url().endsWith("/messages") && r.request().method() === "POST", { timeout: REPLY_MS });
    await box.press("Enter");
    await sent;
    await expect(transcript.getByText(/is replying/)).toBeAttached();
    await page.waitForTimeout(4000);
    await page.getByRole("button", { name: "End practice" }).click();
    await expect(page.getByText("Safely disengaged").first()).toBeVisible({ timeout: 30_000 });
    await expect(transcript.getByText(/is replying/)).toHaveCount(0);
    // Wait past the whole bounded turn so any late commit would have landed.
    await page.waitForTimeout(45_000);
    expect(await transcript.getByRole("listitem").count()).toBeLessThanOrEqual(before + 1); // only the user's message
    await page.reload();
    await expect(page.getByRole("link", { name: "Review your last practice" })).toBeVisible({ timeout: 30_000 });
    t.done("safely_disengaged");
  });
});

test.describe("legitimate scenario (mobile-notice-01)", () => {
  test.skip(SCENARIO !== "notice", "LIVE_SCENARIO is not notice");
  const GREETING = /new monthly statement/;

  test("chat → official check → reload mid-check → Proceed → portal review = verified and completed", async ({ page }) => {
    const t = tracker("legitimate: verified");
    t.row.userTurnsBeforeRequest = "n/a";
    await begin(page, GREETING);
    const transcript = page.getByRole("list", { name: "Conversation transcript" });
    for (const line of ["Who is this?", "What is this about?", "Do I need to do anything?"]) await send(page, t.row, line);
    const opponent = await transcript.getByRole("listitem").filter({ hasNot: page.getByText(/^You$/) }).count();
    log(`${t.row.path}: transcript items after 3 turns: ${await transcript.getByRole("listitem").count()} (opponent-or-other ${opponent})`);
    await expect(page.getByRole("listitem", { name: "Simulated request" })).toHaveCount(0); // never a code request
    const text = (await transcript.innerText()).toLowerCase();
    log(`${t.row.path}: mentions code request: ${/share (the |your )?(practice )?code|send (me )?the code/.test(text)}; mentions payment request: ${/(make|send) (a )?payment|pay (now|the|a fee)/.test(text)}`);

    await page.getByRole("button", { name: "Check official support" }).click();
    const check = page.getByRole("dialog", { name: "Official support check" });
    await check.getByRole("button", { name: "Run check" }).click();
    await expect(check).toContainText(/monthly-statement notice was issued/);
    await page.reload();
    await expect(check).toContainText(/monthly-statement notice was issued/, { timeout: 30_000 });
    await check.getByRole("button", { name: "I have read this result" }).click();
    await check.getByRole("button", { name: "Proceed (simulated)" }).click();
    await check.getByRole("button", { name: "Close official support check" }).click();
    await page.getByRole("button", { name: "Open account portal" }).click();
    const portal = page.getByRole("dialog", { name: "Account portal" });
    await portal.getByRole("button", { name: "Open notice" }).click();
    await portal.getByRole("button", { name: "Mark notice reviewed" }).click();
    await portal.getByRole("button", { name: "Close account portal" }).click();
    await expect(page.getByText("Verified and completed").first()).toBeVisible();
    await page.getByRole("link", { name: "See your review" }).click();
    await expect(page.getByText("Verified and completed").first()).toBeVisible();
    t.done("legitimate_task_completed");
  });

  test("reporting the genuine notice is recorded as declined, never exposure", async ({ page }) => {
    const t = tracker("legitimate: reported");
    t.row.userTurnsBeforeRequest = "n/a";
    await begin(page, GREETING);
    await send(page, t.row, "Who is this?");
    await page.getByRole("button", { name: "Report / block and end" }).click();
    await expect(page.getByText("Genuine notice declined").first()).toBeVisible();
    t.done("legitimate_request_declined");
  });
});
