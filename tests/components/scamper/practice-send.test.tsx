import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, ObserverSessionResponse, ObserverSessionView, TurnStatus } from "@/contracts/observer";
import { ApiClientError } from "@/lib/api-client";

/**
 * Immediate player bubbles (manual-test fix): the bubble appears before the server answers, the reply is
 * followed through the server's `turnStatus`, unknown outcomes are reconciled, failures keep the text, and
 * stop/refresh behave. The API adapter is replaced with controllable fakes; the page logic is real.
 */

const api = vi.hoisted(() => ({
  start: vi.fn(),
  load: vi.fn(),
  send: vi.fn(),
  process: vi.fn(),
  event: vi.fn(),
  retry: vi.fn(),
  directory: vi.fn(),
  account: vi.fn(),
  history: vi.fn(),
  progress: vi.fn(),
}));

vi.mock("@/features/scamper/adapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/scamper/adapter")>();
  return { ...actual, scamperApi: api, sessionIndex: { ...actual.sessionIndex, current: () => SESSION } };
});

const { PracticeWorkspace } = await import("@/features/scamper/practice");

const SESSION = "11111111-1111-4111-8111-111111111111";
const at = "2026-11-08T12:00:00.000Z";
let n = 0;
const msg = (role: Message["role"], content: string, turn = 1): Message => ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, sessionId: SESSION, turn, role, content, createdAt: at });
const OPENING = msg("assistant", "Hi, I'm Avery from Cedar Account Support.", 0);
const idle: TurnStatus = { state: "idle", reason: null, message: null };
const generatingStatus: TurnStatus = { state: "generating", reason: "planning", message: null };

function view(over: Partial<ObserverSessionView> = {}): ObserverSessionView {
  return {
    sessionId: SESSION,
    threadId: SESSION,
    scenario: { id: "practice", version: 0, senderName: "Cedar Account Support", simulationNotice: "Simulation." },
    revision: 1,
    conversationRevision: 1,
    turn: 0,
    maxTurns: 12,
    ended: false,
    stage: "active",
    outcome: null,
    messages: [OPENING],
    requests: [],
    events: [],
    requestStates: [],
    requestStatus: "not_presented",
    practiceCode: null,
    verification: { status: "not_observed", officialResult: null, activeChallengeId: null, attemptId: null },
    stopConfirmationPending: false,
    finalDecisionProceeded: false,
    technicalNotice: null,
    turnStatus: idle,
    verificationLinkIssueId: null,
    issues: [],
    ...over,
  };
}
const res = (session: ObserverSessionView): ObserverSessionResponse => ({ session });
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};

const transcript = () => screen.getByRole("list", { name: "Conversation transcript" });
const userBubbles = (text: string) => within(transcript()).queryAllByText(text);
const box = () => screen.getByRole("textbox", { name: "Message" });
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const enter = () => fireEvent.keyDown(box(), { key: "Enter" });

async function mount(initial = view()) {
  api.load.mockResolvedValue(res(initial));
  render(<PracticeWorkspace />);
  await screen.findByRole("list", { name: "Conversation transcript" });
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.directory.mockReturnValue(new Promise(() => undefined));
  api.process.mockResolvedValue(res(view()));
});
afterEach(() => vi.useRealTimers());

describe("practice: immediate user bubbles and turn status", () => {
  it("shows the bubble and clears the composer before the server answers, then shows exactly one bubble and a typing indicator", async () => {
    await mount();
    const pending = deferred<ObserverSessionResponse>();
    api.send.mockReturnValue(pending.promise);
    type("Who is this?");
    enter();
    // Before any server response: the bubble is there, marked sending, and the composer is empty.
    expect(userBubbles("Who is this?")).toHaveLength(1);
    expect(within(transcript()).getByText("Sending…")).toBeInTheDocument();
    expect(box()).toHaveValue("");
    expect(api.send).toHaveBeenCalledTimes(1);

    const saved = msg("user", "Who is this?");
    await act(async () => pending.resolve(res(view({ revision: 2, messages: [OPENING, saved], turnStatus: generatingStatus }))));
    expect(userBubbles("Who is this?")).toHaveLength(1);
    expect(within(transcript()).queryByText("Sending…")).not.toBeInTheDocument();
    expect(within(transcript()).getByText(/is replying/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send/ })).toBeDisabled(); // single active turn

    // The poll picks up the committed reply; the indicator goes away.
    api.load.mockResolvedValue(res(view({ revision: 3, messages: [OPENING, saved, msg("assistant", "I'm Avery.")], turnStatus: idle })));
    await within(transcript()).findByText("I'm Avery.", undefined, { timeout: 4000 });
    expect(within(transcript()).queryByText(/is replying/)).not.toBeInTheDocument();
    expect(userBubbles("Who is this?")).toHaveLength(1);
  });

  it("ignores a double submission while the first is in flight", async () => {
    await mount();
    api.send.mockReturnValue(new Promise(() => undefined));
    type("Hello");
    enter();
    enter();
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    expect(api.send).toHaveBeenCalledTimes(1);
    expect(userBubbles("Hello")).toHaveLength(1);
  });

  it("marks a rejected save as not sent, keeps the text, and resends with the SAME idempotency key", async () => {
    await mount();
    api.send.mockRejectedValueOnce(new ApiClientError(422, { error: { code: "VALIDATION_ERROR", message: "Could not record that message." }, requestId: "r" } as never));
    type("No thanks");
    enter();
    await within(transcript()).findByText("Not sent");
    expect(userBubbles("No thanks")).toHaveLength(1);
    const key = api.send.mock.calls[0][2];

    api.send.mockResolvedValueOnce(res(view({ revision: 2, messages: [OPENING, msg("user", "No thanks")], turnStatus: generatingStatus })));
    fireEvent.click(screen.getByRole("button", { name: "Send again" }));
    await waitFor(() => expect(within(transcript()).queryByText("Not sent")).not.toBeInTheDocument());
    expect(api.send.mock.calls[1][2]).toBe(key);
    expect(api.send.mock.calls[1][1]).toBe("No thanks");
    expect(userBubbles("No thanks")).toHaveLength(1);
  });

  it("reconciles an unknown network outcome with the server before calling the message unsent", async () => {
    await mount();
    api.send.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    api.load.mockResolvedValueOnce(res(view({ revision: 2, messages: [OPENING, msg("user", "Are you real?")], turnStatus: generatingStatus })));
    type("Are you real?");
    enter();
    await waitFor(() => expect(within(transcript()).queryByText("Sending…")).not.toBeInTheDocument());
    expect(within(transcript()).queryByText("Not sent")).not.toBeInTheDocument();
    expect(userBubbles("Are you real?")).toHaveLength(1);
    expect(api.send).toHaveBeenCalledTimes(1); // reconciled by reading, not by resubmitting
  });

  it("generation failure after the message was saved keeps the bubble and offers Retry reply (no resubmission)", async () => {
    await mount();
    const saved = msg("user", "What do you need?");
    api.send.mockResolvedValueOnce(res(view({ revision: 2, messages: [OPENING, saved], turnStatus: generatingStatus })));
    type("What do you need?");
    enter();
    const failed = view({ revision: 3, messages: [OPENING, saved], technicalNotice: { inputId: saved.id, attempts: 1, canRetry: true, message: "The reply could not be generated." }, turnStatus: { state: "failed", reason: "planning_failed", message: null } });
    api.load.mockResolvedValue(res(failed));
    await screen.findByRole("button", { name: "Retry reply" }, { timeout: 4000 });
    expect(userBubbles("What do you need?")).toHaveLength(1);
    expect(within(transcript()).queryByText(/is replying/)).not.toBeInTheDocument();

    api.retry.mockResolvedValueOnce(res(view({ revision: 4, messages: [OPENING, saved], turnStatus: generatingStatus })));
    fireEvent.click(screen.getByRole("button", { name: "Retry reply" }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledTimes(1));
    expect(api.send).toHaveBeenCalledTimes(1);
  });

  it("after a refresh mid-turn, recovers the pending turn from the server and shows the reply when it lands", async () => {
    const saved = msg("user", "hey");
    await mount(view({ revision: 2, messages: [OPENING, saved], turnStatus: generatingStatus }));
    expect(within(transcript()).getByText(/is replying/)).toBeInTheDocument();
    expect(userBubbles("hey")).toHaveLength(1);
    api.load.mockResolvedValue(res(view({ revision: 3, messages: [OPENING, saved, msg("assistant", "Hi again.")], turnStatus: idle })));
    await within(transcript()).findByText("Hi again.", undefined, { timeout: 4000 });
    expect(userBubbles("hey")).toHaveLength(1);
  });

  it("End practice while generating removes the indicator at once and a late (older) poll cannot bring a reply back", async () => {
    const saved = msg("user", "asdf");
    await mount(view({ revision: 2, messages: [OPENING, saved], turnStatus: generatingStatus }));
    const ended = view({ revision: 3, messages: [OPENING, saved], ended: true, stage: "ended", outcome: "safely_disengaged", turnStatus: idle });
    api.event.mockResolvedValueOnce(res(ended));
    // A slow poll that started before the stop resolves afterwards with the older revision.
    api.load.mockResolvedValue(res(view({ revision: 2, messages: [OPENING, saved], turnStatus: generatingStatus })));
    fireEvent.click(screen.getByRole("button", { name: "End practice" }));
    await screen.findByText("Practice ended");
    expect(within(transcript()).queryByText(/is replying/)).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1500));
    expect(screen.getByText("Practice ended")).toBeInTheDocument();
    expect(within(transcript()).queryByText(/is replying/)).not.toBeInTheDocument();
  });

  it("explains an intentional pause instead of leaving silence", async () => {
    await mount(view({ revision: 3, messages: [OPENING, msg("user", "I'll verify first.")], turnStatus: { state: "paused", reason: "P6", message: "Cedar Account Support is waiting while you check with official support." } }));
    expect(screen.getByText(/waiting while you check with official support/)).toHaveAttribute("role", "status");
    expect(within(transcript()).queryByText(/is replying/)).not.toBeInTheDocument();
  });
});
