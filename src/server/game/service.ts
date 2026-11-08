import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type {
  ActionResponse,
  CreateSessionRequest,
  DebriefResponse,
  DeveloperLogResponse,
  ForkRequest,
  PlayerView,
  ReplayResponse,
  SubmitActionRequest,
} from "@/contracts/game";
import { HttpError, NotFoundError } from "@/server/http/errors";
import { materialize } from "./engine/commit";
import { decide, triggersOpponentTurn, type Command, type OpponentOrigin } from "./engine/decide";
import type { GameEvent } from "./engine/events";
import { buildForkStream, CheckpointUnavailableError } from "./engine/fork";
import { buildReplay } from "./engine/replay";
import { buildDebrief } from "./engine/scoring";
import { initialState } from "./engine/state";
import { toPlayerView } from "./engine/view";
import type { ModelClient } from "./opponent/client";
import { scriptedOpponentCalls } from "./opponent/fallback";
import { runLiveTurn, type ParsedToolCall, type ToolDispatchResult } from "./opponent/live-turn";
import { buildOpponentObservation } from "./opponent/observation";
import { OBSERVATION_FIELDS } from "./opponent/observation-schema";
import { bankAlertScenario } from "./scenario/bank-alert";
import type { Scenario } from "./scenario/schema";
import type { GameStore, LastTurn, PendingTurn, SessionRecord, TurnRecord } from "./store/types";

type Loaded = { session: SessionRecord; events: GameEvent[] };

export type GameServiceDeps = {
  store: GameStore;
  /** Returns a model client, or null when the provider is unconfigured (labeled fallback). */
  modelClient: () => ModelClient | null;
  scenario?: Scenario;
  newId?: () => string;
  now?: () => Date;
  /** Extra time after the turn deadline before a pending turn counts as expired. */
  pendingGraceMs?: number;
};

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v,
  );
const hashOf = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

const rejected = (reason: string, message: string) => new HttpError(422, "ACTION_REJECTED", message, { reason });
const versionConflict = (currentVersion: number) =>
  new HttpError(409, "VERSION_CONFLICT", "This session changed. Refresh and try again.", { currentVersion });

export class GameService {
  private readonly scenario: Scenario;
  private readonly newId: () => string;
  private readonly now: () => Date;
  private readonly graceMs: number;

  constructor(private readonly deps: GameServiceDeps) {
    this.scenario = deps.scenario ?? bankAlertScenario;
    this.newId = deps.newId ?? randomUUID;
    this.now = deps.now ?? (() => new Date());
    this.graceMs = deps.pendingGraceMs ?? 10_000;
  }

  // ---------- reads ----------

  private async loadOwned(ownerKey: string, sessionId: string): Promise<Loaded> {
    const loaded = await this.deps.store.loadOwned(sessionId, ownerKey);
    if (!loaded) throw new NotFoundError("Game session");
    return loaded;
  }

  private async view(loaded: Loaded): Promise<PlayerView> {
    const forkSessionIds = await this.deps.store.listForkIds(loaded.session.id);
    return toPlayerView(
      this.scenario,
      {
        sessionId: loaded.session.id,
        version: loaded.session.version,
        opponentMode: loaded.session.opponentMode,
        pendingTurn: loaded.session.pendingTurn,
        lastTurn: loaded.session.lastTurn,
        forkSessionIds,
      },
      loaded.session.state,
      loaded.events,
    );
  }

  async getSession(ownerKey: string, sessionId: string): Promise<PlayerView> {
    const loaded = await this.recoverIfExpired(await this.loadOwned(ownerKey, sessionId));
    return this.view(loaded);
  }

  async replay(ownerKey: string, sessionId: string): Promise<ReplayResponse> {
    const { session, events } = await this.loadOwned(ownerKey, sessionId);
    const forkSessionIds = await this.deps.store.listForkIds(session.id);
    return buildReplay(this.scenario, { sessionId: session.id, version: session.version, forkSessionIds, storedState: session.state }, events);
  }

  async debrief(ownerKey: string, sessionId: string): Promise<DebriefResponse> {
    const { session, events } = await this.loadOwned(ownerKey, sessionId);
    const forkSessionIds = await this.deps.store.listForkIds(session.id);
    const debrief = buildDebrief(this.scenario, { sessionId: session.id, forkSessionIds }, session.state, events);
    if (!debrief) throw rejected("ENCOUNTER_ACTIVE", "Finish the encounter to see the debrief.");
    return debrief;
  }

  async developerLog(ownerKey: string, sessionId: string): Promise<DeveloperLogResponse> {
    const { session } = await this.loadOwned(ownerKey, sessionId);
    const turns = await this.deps.store.listTurns(session.id);
    return {
      sessionId: session.id,
      turns: turns.map((t) => ({
        turnId: t.turnId,
        triggerActionId: t.triggerActionId,
        status: t.status,
        origin: t.origin,
        fallbackReason: t.fallbackReason,
        modelId: t.modelId,
        modelRequests: t.modelRequests,
        latencyMs: t.latencyMs,
        observationFields: t.observationFields,
        toolCalls: t.toolCalls,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
      })),
    };
  }

  // ---------- create / restart / fork ----------

  async createSession(ownerKey: string, request: Required<CreateSessionRequest>): Promise<PlayerView> {
    const sessionId = randomUUID();
    const start = decide(this.scenario, initialState(this.scenario), { actor: "system", kind: "start" });
    if (!start.ok) throw new Error(start.message);
    const { events, state } = materialize(initialState(this.scenario), start.events, {
      sessionId,
      actionId: "system:start",
      newId: this.newId,
      now: this.now().toISOString(),
    });
    const session: SessionRecord = {
      id: sessionId,
      ownerKey,
      scenarioId: this.scenario.scenarioId,
      scenarioVersion: this.scenario.version,
      opponentMode: request.opponentMode,
      version: 1,
      state,
      pendingTurn: null,
      lastTurn: null,
      parentSessionId: null,
      checkpointEventId: null,
    };
    await this.deps.store.createSession(session, events);
    return this.view({ session, events });
  }

  async fork(ownerKey: string, sessionId: string, request: ForkRequest): Promise<PlayerView> {
    const parent = await this.loadOwned(ownerKey, sessionId);
    if (request.checkpointId !== this.scenario.checkpoint.checkpointId) throw rejected("CHECKPOINT_UNAVAILABLE", "Unknown checkpoint.");
    const forkId = randomUUID();
    let stream: ReturnType<typeof buildForkStream>;
    try {
      stream = buildForkStream(
        this.scenario,
        { sessionId: parent.session.id, state: parent.session.state, events: parent.events },
        { sessionId: forkId, newId: this.newId, now: this.now().toISOString() },
      );
    } catch (error) {
      if (error instanceof CheckpointUnavailableError) throw rejected("CHECKPOINT_UNAVAILABLE", error.message);
      throw error;
    }
    const session: SessionRecord = {
      id: forkId,
      ownerKey,
      scenarioId: this.scenario.scenarioId,
      scenarioVersion: this.scenario.version,
      opponentMode: parent.session.opponentMode,
      version: 1,
      state: stream.state,
      pendingTurn: null,
      lastTurn: null,
      parentSessionId: parent.session.id,
      checkpointEventId: stream.checkpointEventId,
    };
    await this.deps.store.createSession(session, stream.events);
    return this.view({ session, events: stream.events });
  }

  // ---------- player actions ----------

  async submitAction(ownerKey: string, sessionId: string, request: SubmitActionRequest): Promise<ActionResponse> {
    let loaded = await this.loadOwned(ownerKey, sessionId);
    loaded = await this.recoverIfExpired(loaded);
    const payloadHash = hashOf(request.action);

    const duplicate = async (receipt: { payloadHash: string; eventIds: string[] }): Promise<ActionResponse> => {
      if (receipt.payloadHash !== payloadHash)
        throw new HttpError(409, "IDEMPOTENCY_CONFLICT", "This action id was already used for a different action.");
      const fresh = await this.loadOwned(ownerKey, sessionId);
      return { session: await this.view(fresh), result: { status: "duplicate", eventIds: receipt.eventIds, opponentTurn: null } };
    };

    const existing = await this.deps.store.findReceipt(sessionId, request.actionId);
    if (existing) return duplicate(existing);

    const { session } = loaded;
    if (request.expectedVersion !== session.version) throw versionConflict(session.version);
    const turnPending = session.pendingTurn !== null;
    if (request.action.type === "send_message" && turnPending) throw rejected("TURN_PENDING", "Wait for the reply before sending another message.");

    const decision = decide(this.scenario, session.state, { actor: "player", action: request.action });
    if (!decision.ok) throw rejected(decision.reason, decision.message);
    const { events, state } = materialize(session.state, decision.events, {
      sessionId,
      actionId: request.actionId,
      newId: this.newId,
      now: this.now().toISOString(),
    });

    const startTurn = events.length > 0 && triggersOpponentTurn(request.action) && !turnPending && state.status === "active";
    const startedAt = this.now();
    const turn: PendingTurn | null = startTurn
      ? {
          turnId: `turn-${randomUUID()}`,
          startedAt: startedAt.toISOString(),
          expiresAt: new Date(startedAt.getTime() + this.scenario.limits.turnDeadlineMs + this.graceMs).toISOString(),
        }
      : null;

    // One transaction: CAS version + events + receipt (+ pending turn marker). Released before any model call.
    const committed = await this.deps.store.commit({
      sessionId,
      expectedVersion: session.version,
      events,
      state,
      bumpVersion: events.length > 0,
      receipt: { actionId: request.actionId, payloadHash, resultVersion: 0, eventIds: events.map((e) => e.eventId) },
      ...(turn ? { pendingTurn: { set: turn } } : {}),
    });
    if (!committed.ok) {
      const raced = await this.deps.store.findReceipt(sessionId, request.actionId);
      if (raced) return duplicate(raced);
      const fresh = await this.deps.store.loadById(sessionId);
      throw versionConflict(fresh?.session.version ?? session.version);
    }

    const opponentTurn = turn ? await this.runTurn(sessionId, turn, request.actionId) : null;
    return {
      session: await this.view(await this.loadOwned(ownerKey, sessionId)),
      result: { status: "applied", eventIds: events.map((e) => e.eventId), opponentTurn },
    };
  }

  // ---------- opponent turn ----------

  /** Validated, idempotent, atomic commit of ONE opponent proposal for a still-current turn. */
  private async dispatchOpponent(sessionId: string, turnId: string, call: ParsedToolCall, origin: OpponentOrigin): Promise<ToolDispatchResult> {
    const actionId = `turn:${turnId}:${call.callId}`;
    const payloadHash = hashOf({ name: call.name, args: call.args });
    const command: Command =
      call.name === "sendSimulatedMessage"
        ? { actor: "opponent", kind: "message", text: call.args.text, origin, turnId }
        : call.name === "presentPaymentRequest"
          ? { actor: "opponent", kind: "payment_request", recipientId: call.args.recipientId, amount: call.args.amount, origin, turnId }
          : { actor: "opponent", kind: "finish", origin, turnId };

    for (let attempt = 0; attempt < 4; attempt++) {
      const receipt = await this.deps.store.findReceipt(sessionId, actionId);
      if (receipt) return { status: "duplicate", reason: null, message: null, eventIds: receipt.eventIds, encounterEnded: false };
      const loaded = await this.deps.store.loadById(sessionId);
      if (!loaded || loaded.session.pendingTurn?.turnId !== turnId)
        return { status: "rejected", reason: "TURN_STALE", message: "This turn is no longer active.", eventIds: [], encounterEnded: false };
      const decision = decide(this.scenario, loaded.session.state, command);
      if (!decision.ok) return { status: "rejected", reason: decision.reason, message: decision.message, eventIds: [], encounterEnded: false };
      const { events, state } = materialize(loaded.session.state, decision.events, {
        sessionId,
        actionId,
        newId: this.newId,
        now: this.now().toISOString(),
      });
      const committed = await this.deps.store.commit({
        sessionId,
        expectedVersion: loaded.session.version,
        requirePendingTurnId: turnId,
        events,
        state,
        bumpVersion: true,
        receipt: { actionId, payloadHash, resultVersion: 0, eventIds: events.map((e) => e.eventId) },
      });
      if (committed.ok) {
        const requested = events.find((e) => e.type === "payment.requested");
        return {
          status: "applied",
          reason: null,
          message: null,
          eventIds: events.map((e) => e.eventId),
          ...(requested && requested.type === "payment.requested" ? { requestId: requested.payload.requestId } : {}),
          encounterEnded: state.status === "ended",
        };
      }
      if (committed.conflict === "turn")
        return { status: "rejected", reason: "TURN_STALE", message: "This turn is no longer active.", eventIds: [], encounterEnded: false };
      // version/receipt race with a player action: re-read and re-decide against fresh state.
    }
    return { status: "rejected", reason: "COMMIT_CONFLICT", message: "The game state kept changing; try again next turn.", eventIds: [], encounterEnded: false };
  }

  private async runFallback(sessionId: string, turnId: string, log: TurnRecord) {
    const loaded = await this.deps.store.loadById(sessionId);
    if (!loaded || loaded.session.pendingTurn?.turnId !== turnId || loaded.session.state.status !== "active") return;
    for (const call of scriptedOpponentCalls(buildOpponentObservation(this.scenario, loaded.session.state), turnId)) {
      const outcome = await this.dispatchOpponent(sessionId, turnId, call, "scripted_fallback");
      log.toolCalls.push({ callId: call.callId, name: call.name, arguments: call.args, status: outcome.status, rejectionReason: outcome.reason, eventIds: outcome.eventIds });
      if (outcome.encounterEnded) break;
    }
  }

  /** Clears the pending marker for `turnId` only (a newer/recovered turn is left alone). */
  private async finishTurn(sessionId: string, turnId: string, lastTurn: LastTurn | null) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const loaded = await this.deps.store.loadById(sessionId);
      if (!loaded || loaded.session.pendingTurn?.turnId !== turnId) return;
      const committed = await this.deps.store.commit({
        sessionId,
        expectedVersion: loaded.session.version,
        requirePendingTurnId: turnId,
        events: [],
        state: loaded.session.state,
        bumpVersion: false,
        receipt: null,
        pendingTurn: { clear: true },
        ...(lastTurn ? { lastTurn } : {}),
      });
      if (committed.ok || committed.conflict === "turn") return;
    }
  }

  private async runTurn(sessionId: string, turn: PendingTurn, triggerActionId: string) {
    const startedMs = this.now().getTime();
    const log: TurnRecord = {
      turnId: turn.turnId,
      sessionId,
      triggerActionId,
      status: "pending",
      origin: null,
      fallbackReason: null,
      modelId: null,
      modelRequests: 0,
      latencyMs: null,
      observationFields: [...OBSERVATION_FIELDS],
      toolCalls: [],
      startedAt: turn.startedAt,
      completedAt: null,
    };
    await this.deps.store.saveTurn(log);

    const loaded = await this.deps.store.loadById(sessionId);
    if (!loaded) return null;

    // Encounter-wide turn cap: the engine ends the encounter instead of calling the model.
    if (loaded.session.state.opponentTurnIds.length >= this.scenario.limits.maxOpponentTurns) {
      const cap = decide(this.scenario, loaded.session.state, { actor: "system", kind: "turn_cap", turnId: turn.turnId });
      if (cap.ok) {
        const { events, state } = materialize(loaded.session.state, cap.events, {
          sessionId,
          actionId: `system:turn-cap:${turn.turnId}`,
          newId: this.newId,
          now: this.now().toISOString(),
        });
        await this.deps.store.commit({ sessionId, expectedVersion: loaded.session.version, requirePendingTurnId: turn.turnId, events, state, bumpVersion: true, receipt: null, pendingTurn: { clear: true } });
      }
      await this.finishTurn(sessionId, turn.turnId, null);
      await this.deps.store.saveTurn({ ...log, status: "completed", completedAt: this.now().toISOString() });
      return null;
    }

    let origin: LastTurn["origin"] = "live_model";
    let fallbackReason: LastTurn["fallbackReason"] = null;
    const client = loaded.session.opponentMode === "scripted" ? null : this.deps.modelClient();
    let failed = false;
    if (loaded.session.opponentMode === "scripted") fallbackReason = "scripted_mode";
    else if (!client) fallbackReason = "provider_unconfigured";
    else {
      log.modelId = client.modelId;
      const live = await runLiveTurn({
        client,
        scenario: this.scenario,
        observation: buildOpponentObservation(this.scenario, loaded.session.state),
        deadlineAt: startedMs + this.scenario.limits.turnDeadlineMs,
        now: () => this.now().getTime(),
        dispatch: (call) => this.dispatchOpponent(sessionId, turn.turnId, call, "live_model"),
      });
      log.modelRequests = live.modelRequests;
      log.toolCalls.push(...live.toolCalls);
      // A live turn that already delivered a message is kept even if a later request failed.
      if (live.failure && live.appliedMessages === 0) fallbackReason = live.failure;
      failed = live.failure !== null;
    }

    if (fallbackReason) {
      origin = "scripted_fallback";
      await this.runFallback(sessionId, turn.turnId, log);
    }

    const lastTurn: LastTurn = { turnId: turn.turnId, origin, fallbackReason };
    await this.finishTurn(sessionId, turn.turnId, lastTurn);
    const completedAt = this.now();
    await this.deps.store.saveTurn({
      ...log,
      status: failed && !fallbackReason ? "failed" : "completed",
      origin,
      fallbackReason,
      latencyMs: completedAt.getTime() - startedMs,
      completedAt: completedAt.toISOString(),
    });
    const applied = log.toolCalls.filter((c) => c.status === "applied").length;
    return { turnId: turn.turnId, origin, fallbackReason, appliedToolCalls: applied, rejectedToolCalls: log.toolCalls.filter((c) => c.status === "rejected").length };
  }

  /**
   * A crashed/abandoned invocation must not lock the encounter: an expired pending turn is
   * completed with the labeled fallback (idempotent call ids) and cleared, on the next request.
   */
  private async recoverIfExpired(loaded: Loaded): Promise<Loaded> {
    const pending = loaded.session.pendingTurn;
    if (!pending || new Date(pending.expiresAt).getTime() > this.now().getTime()) return loaded;
    const turns = await this.deps.store.listTurns(loaded.session.id);
    const log: TurnRecord = turns.find((t) => t.turnId === pending.turnId) ?? {
      turnId: pending.turnId,
      sessionId: loaded.session.id,
      triggerActionId: "unknown",
      status: "pending",
      origin: null,
      fallbackReason: null,
      modelId: null,
      modelRequests: 0,
      latencyMs: null,
      observationFields: [...OBSERVATION_FIELDS],
      toolCalls: [],
      startedAt: pending.startedAt,
      completedAt: null,
    };
    await this.runFallback(loaded.session.id, pending.turnId, log);
    await this.finishTurn(loaded.session.id, pending.turnId, { turnId: pending.turnId, origin: "scripted_fallback", fallbackReason: "expired_turn" });
    await this.deps.store.saveTurn({ ...log, status: "expired", origin: "scripted_fallback", fallbackReason: "expired_turn", completedAt: this.now().toISOString() });
    return (await this.deps.store.loadById(loaded.session.id)) ?? loaded;
  }
}

