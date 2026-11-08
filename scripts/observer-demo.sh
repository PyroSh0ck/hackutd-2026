#!/usr/bin/env bash
# Practice-session demo over HTTP (observer + planner + actor): question → answer → request card →
# refusal acknowledged → independent verification → final decision → reject and report. Needs a running
# server and jq.
#   Fixture models (no credentials):  E2E_TEST=1 OBSERVER_MODEL_MODE=fixture pnpm dev
#   Real models: set MODEL_* in .env.local, then pnpm dev
#   bash scripts/observer-demo.sh [base-url]        (default http://localhost:3000)
set -euo pipefail
BASE="${1:-http://localhost:3000}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
api() { curl -sS -H "Origin: $BASE" -H "Content-Type: application/json" -b "$JAR" -c "$JAR" "$@"; }
key() { uuidgen | tr 'A-Z' 'a-z'; }

S=$(api -X POST "$BASE/api/observer/sessions" | jq -r .session.sessionId)
echo "session $S"
last() { jq -r '.session | "stage=\(.stage) request=\(.requestStatus) outcome=\(.outcome) | sender: \(.messages | map(select(.role=="assistant")) | last | .content)"'; }
say() { echo "> $1"; api -X POST "$BASE/api/observer/sessions/$S/messages" -d "$(jq -n --arg k "$(key)" --arg c "$1" '{idempotencyKey:$k, content:$c}')" | last; }
event() { api -X POST "$BASE/api/observer/sessions/$S/events" -d "$(jq -n --arg k "$(key)" --arg t "$1" --arg r "${2:-}" --arg ch "${3:-}" '{idempotencyKey:$k, type:$t, requestId:(if $r == "" then null else $r end)} + (if $ch == "" then {} else {challengeId:$ch} end)')"; }

say "Who are you?"
say "Sure, go on."
say "I won't send the code."
REQ=$(api "$BASE/api/observer/sessions/$S" | jq -r '.session.requests[-1].id')
echo "--- request card declined (UI event)"; event request_rejected "$REQ" | last
echo "--- verify independently"
C=$(event official_verification_started | jq -r .challengeId)
event official_verification_completed "" "$C" | jq -r '.session | "stage=\(.stage) official result: \(.verification.officialResult)"'
echo "--- final decision: reject and report"; event conversation_reported | last
echo "--- plan audit"
api "$BASE/api/observer/sessions/$S/plans" | jq -c '.plans[] | {status, rule: .ruleId, move: (.candidateSnapshot[] as $c | select($c.id == .acceptedPlan.candidateId) | $c.moveId), plannerCalls: (.attempts | length), actorCalls: (.actorAudit.attempts // [] | length), reused: (.reusedPlanFrom != null)}'
