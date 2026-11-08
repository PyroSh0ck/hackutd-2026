#!/usr/bin/env bash
# Observer demo over HTTP: acceptance, refusal, conditional acceptance, flagged correction, ambiguous
# fallback, and an app-verified action. Needs a running server and jq.
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
say() { api -X POST "$BASE/api/observer/sessions/$S/messages" -d "$(jq -n --arg k "$(key)" --arg c "$1" '{idempotencyKey:$k, content:$c}')" | jq -c --arg c "$1" '{said:$c, processing}'; }
event() { api -X POST "$BASE/api/observer/sessions/$S/events" -d "$(jq -n --arg k "$(key)" --arg t "$1" --arg ch "${2:-}" '{idempotencyKey:$k, type:$t, requestId:null} + (if $ch == "" then {} else {challengeId:$ch} end)')"; }

say "Yes, I'll send the code."
say "I won't send the code."
say "Only after I contact official support myself."
say "If I sent it, would that help?"
say "Okay."

echo "--- assessments for the code request (model interpretations)"
CODE=$(api "$BASE/api/observer/sessions/$S" | jq -r '.session.requests[] | select(.targetAction=="share_fictional_code") | .id')
api "$BASE/api/observer/sessions/$S/assessments" | jq -c --arg r "$CODE" '.assessments[] | select(.requestId==$r) | {label:.finalAssessment.decision.label, proposed:.proposedAssessment.decision.label, reviewStatus, resolution, failureReason, calls:(.attempts|length)}'

echo "--- app-verified action (server facts)"
C=$(event official_directory_opened | jq -r .challengeId)
event official_verification_completed "$C" > /dev/null
api -X POST "$BASE/api/observer/sessions/$S/events" -d "$(jq -n --arg k "$(key)" --arg r "$CODE" '{idempotencyKey:$k, type:"practice_code_submitted", requestId:$r}')" > /dev/null
api "$BASE/api/observer/sessions/$S/planner" | jq -c '.observations[] | {target:.request.targetAction, label:.assessment.decision.label, previous:.previousAssessment.decision.label, action:.action.status, inAppVerification:.inAppVerification.status, unresolved:(.unresolvedQuestions|length)}'
