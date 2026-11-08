# Cyber Sleuth

**Practice spotting scams before the stakes are real.** Cyber Sleuth is an AI-powered scam-awareness experience where you chat with a convincing sender, question their claims, verify through trusted in-app channels, and choose what to do next.

Built for **HackUTD 2026**, Cyber Sleuth turns scam-safety advice into an interactive challenge. The exercise is clearly labeled as fictional, and every code and account detail is simulated.

## The demo

Open the app at **`/scamper`**, start a practice session, and talk with the sender. Try asking who they are, what they need, or how you can verify the request. The AI adapts its next move to the conversation while server rules keep it within the scenario.

For a cooperative path, try:

1. “Who is this?”
2. “Okay, what do you need from me?”
3. “Alright, go ahead.”

For a skeptical path, ask “Prove it.” The sender should be honest about what the conversation can establish. If challenged again, it should back off rather than invent proof or repeat the same claim.

Use **Check official support** to reveal the fictional ground truth. If the sender presents a request, it appears in a separate in-app card; chat text alone can’t submit it. End or report the conversation, then open the review to see the evidence, outcome, and system trace.

## What makes it different

Cyber Sleuth combines a live AI conversation with a deterministic training engine. The model can interpret a message, choose a permitted move, and write a reply; it cannot decide that verification succeeded, change what the player chose, or create an outcome. The server checks each move against session state before committing it.

The conversation runs through four stages:

| Stage | Role |
| --- | --- |
| Observer | Interprets the player’s message and cites evidence. A reviewer checks selected uncertain or consequential interpretations. |
| Planner | Chooses from moves allowed by the current scenario and session state. |
| Actor | Writes the sender’s next message using only permitted facts. |
| Training engine | Revalidates the move and commits replies, requests, and outcomes atomically. |

The app includes two scenarios: **`mobile-code-01`**, a fraudulent request for a fictional one-time code, and **`mobile-notice-01`**, a genuine fictional statement notice checked through a trusted account portal.

## Run it locally

You’ll need Node.js 22+, pnpm, a live model API key, and SpacetimeDB 2.14.1. Install dependencies:

```bash
pnpm install --frozen-lockfile
```

Add your model settings to `.env.local` (this file is gitignored):

```dotenv
MODEL_BASE_URL=https://integrate.api.nvidia.com/v1
MODEL_API_KEY=your-nvidia-api-key
MODEL_ID=nvidia/nemotron-3.5-bolt-e4b
```

Install the [SpacetimeDB CLI](https://spacetimedb.com/install), then start a local database:

```bash
pnpm spacetime:start
```

In another terminal, publish the module and authorize its worker:

```bash
spacetime server add stdb-local --url http://127.0.0.1:3300
pnpm spacetime:publish
pnpm spacetime:setup
```

Run the app:

```bash
TRAINING_BACKEND=spacetime \
PLANNER_PROTOCOL=tools \
PRACTICE_SCENARIOS=mobile-code-01 \
pnpm dev
```

Visit `http://localhost:3000/scamper`. Check `/api/ready` to confirm the model and database are available and fixture mode is off. Set `PRACTICE_SCENARIOS=mobile-code-01,mobile-notice-01` to enable both scenarios.

To work on the UI without model credentials, run deterministic fixture agents:

```bash
E2E_TEST=1 OBSERVER_MODEL_MODE=fixture pnpm dev
```

Fixture mode is for development and testing; it does not demonstrate live AI behavior.

## Under the hood

The web app uses Next.js, React, and TypeScript. Nemotron provides the observer, planner, and actor models. SpacetimeDB owns authoritative training state, while shared rules in `src/server/engine/` enforce the same transitions in supported local test paths. The browser talks only to the Next.js server; model and worker credentials remain server-side.

The review page includes a **How this session worked** panel with the backend, models, observer decisions, planner tool calls, and outcome. It shows execution records, not hidden model reasoning.

## Checks

```bash
pnpm check                 # lint, typecheck, unit and component tests
pnpm test:integration      # API and browser integration tests
pnpm test:spacetime        # engine tests against a running SpacetimeDB
pnpm practice:smoke        # live-model pipeline smoke test
pnpm practice:skeptical    # live skeptical and cooperative conversations
```

For browser tests against a running live-model server:

```bash
LIVE_BASE_URL=http://localhost:3000 pnpm test:live
```

Set `LIVE_SCENARIO=notice` when the server is configured for `mobile-notice-01`. Live results depend on model availability and latency; these checks demonstrate individual runs, not guaranteed success on every turn. The skeptical smoke test uses real models with isolated in-memory state, so it does not verify a deployed SpacetimeDB module.

## Project notes

For deployment settings, current demo evidence, and known limitations, see [`docs/agents/DEMO-READINESS.md`](docs/agents/DEMO-READINESS.md). The project brief and handoff are in [`handoff.md`](handoff.md).
