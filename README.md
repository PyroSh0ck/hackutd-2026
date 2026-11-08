# Cyber Sleuth

Cyber Sleuth is a scam-awareness practice app. Players chat with an AI-controlled sender, practice asking questions and checking claims, and decide whether to act, disengage, or report. The exercise is clearly labeled as fictional; all codes and account details are simulated.

The main experience is at **`/scamper`**. The app currently includes two scenarios:

- **`mobile-code-01`**: a fictional support agent asks for a one-time practice code. Players can check the claim through the app’s official-support flow before deciding what to do.
- **`mobile-notice-01`**: a genuine fictional statement notice that can be checked against a trusted in-app account portal.

## Product flow

1. Start a practice session and chat with the sender.
2. Ask who they are, what they need, or how the request works. The sender responds within the facts permitted for the selected scenario.
3. Use the in-app official-support check to review the authoritative result. The sender cannot see that hidden result.
4. If a simulated request appears, choose through its request card. Typing acceptance in chat does not submit anything.
5. End or report the conversation, then review the transcript, evidence, outcome, and a summary of which system components ran.

If a model turn fails, the app preserves the player’s message and offers a bounded retry. Ending a session prevents a late model response from reviving it.

## How it works

The agents have separate responsibilities, while server rules control what can happen:

| Part | Responsibility |
| --- | --- |
| Observer | Interprets the latest player message and cites supporting text. A reviewer checks selected uncertain or consequential interpretations. |
| Eligibility rules | Produce the moves permitted by the current scenario and authoritative session state. |
| Planner | Selects one permitted move. In tool mode it reads current training context and asks the server to execute the move. |
| Actor | Writes the sender’s next message using only the selected move’s allowed facts. Deterministic checks reject prohibited content and invalid output. |
| Training engine | Rechecks the session revision, turn claim, current input, and eligible move before committing a reply or simulated request. |

`spacetime/` is the authoritative SpacetimeDB module. The same pure transition rules live in `src/server/engine/` and are shared with the local store backend. The browser communicates only with Next.js routes; worker credentials and model keys stay on the server. Player sessions use anonymous, signed `httpOnly` cookies.

## Requirements

- Node.js 22 or newer
- pnpm (the repository declares its package manager version in `package.json`)
- NVIDIA-compatible model API credentials for live agent behavior
- SpacetimeDB 2.14.1 for the authoritative SpacetimeDB setup
- PostgreSQL for authentication and the Prisma-backed test/development paths

## Local development

Install dependencies:

```bash
pnpm install --frozen-lockfile
```

Create `.env.local` with the model settings below. Keep it out of Git; `.env*` files are ignored.

```dotenv
MODEL_BASE_URL=https://integrate.api.nvidia.com/v1
MODEL_API_KEY=your-nvidia-api-key
MODEL_ID=nvidia/nemotron-3.5-bolt-e4b
```

### Connect a local SpacetimeDB

Install the SpacetimeDB CLI using the [official installation instructions](https://spacetimedb.com/install). Then run:

```bash
pnpm spacetime:start
```

In a second terminal, register the local server, publish the module, and create its worker authorization:

```bash
spacetime server add stdb-local --url http://127.0.0.1:3300
pnpm spacetime:publish
pnpm spacetime:setup
```

The setup writes a local worker file under `.spacetime/`; that directory is ignored by Git. Start the app with:

```bash
TRAINING_BACKEND=spacetime \
PLANNER_PROTOCOL=tools \
PRACTICE_SCENARIOS=mobile-code-01 \
pnpm dev
```

Open `http://localhost:3000/scamper`. Check `http://localhost:3000/api/ready`; for live SpacetimeDB use, it should report a reachable Spacetime backend, configured models, and fixture models disabled.

`PRACTICE_SCENARIOS` accepts `mobile-code-01`, `mobile-notice-01`, or both separated by commas. The default enables both.

### Maincloud

For a shared SpacetimeDB deployment, authenticate with the CLI and run:

```bash
pnpm spacetime:publish:maincloud
pnpm spacetime:setup:maincloud
```

Set `SPACETIME_WORKER_FILE=.spacetime/maincloud.json`, or configure `SPACETIME_URL`, `SPACETIME_DATABASE`, and `SPACETIME_TOKEN` in the server environment. Publishing changes the shared module; use the local server workflow for isolated development.

### Fixture mode

Deterministic fixture agents are useful for UI and integration development, but do not test live model quality:

```bash
E2E_TEST=1 OBSERVER_MODEL_MODE=fixture pnpm dev
```

## Tests and diagnostics

| Command | Purpose |
| --- | --- |
| `pnpm check` | Lint, typecheck, and unit/component tests. |
| `pnpm test:integration` | API and browser integration suite. Requires the test database configuration. |
| `pnpm test:spacetime` | Engine tests against a running SpacetimeDB server. |
| `pnpm practice:smoke` | One live-model pipeline check using the configured backend. |
| `pnpm practice:skeptical` | Live-model checks for refusal, proof challenges, backing off, and the cooperative code-request path. Uses an isolated in-memory store. |
| `LIVE_BASE_URL=http://localhost:3000 pnpm test:live` | Opt-in browser tests against an already running server with real models. Set `LIVE_SCENARIO=notice` for the legitimate notice scenario. |

Live model results vary with provider availability and latency. These checks measure specific runs; they cannot guarantee every model response. The review page’s **How this session worked** panel shows the backend, models, observer decisions, planner tool calls, and session outcome without exposing model reasoning.

## Deployment

The app can be hosted on Vercel. Configure secrets as server-only environment variables; never use `NEXT_PUBLIC_` for credentials. Typical settings include:

```text
TRAINING_BACKEND=spacetime
PLANNER_PROTOCOL=tools
SPACETIME_URL=https://maincloud.spacetimedb.com
SPACETIME_DATABASE=your-database-name
SPACETIME_TOKEN=authorized-worker-token
MODEL_BASE_URL=https://integrate.api.nvidia.com/v1
MODEL_API_KEY=your-nvidia-api-key
MODEL_ID=nvidia/nemotron-3.5-bolt-e4b
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=a-stable-secret-at-least-32-characters-long
BETTER_AUTH_URL=https://your-deployment.example
PRACTICE_SCENARIOS=mobile-code-01
```

Configure any optional model IDs, observer policy, and database settings required by your deployment. Keep `E2E_TEST`, `OBSERVER_MODEL_MODE`, and `AGENT_DEBUG` unset in production. Use a stable auth secret; rotating it invalidates existing anonymous session cookies.

## Known limitations

- AI responses and latency vary; live checks do not establish a guaranteed success rate.
- The skeptical-path smoke test exercises the real models with an isolated in-memory store. It does not verify a deployed SpacetimeDB module.
- Session history belongs to the browser’s anonymous cookie and does not transfer across devices.
- The legitimate notice scenario has narrower reply facts and may produce less detailed answers than the code-request scenario.
- Evaluation labels and automated scenario checks still need ongoing human review.

For the project brief, current backend status, and demo evidence, see [`docs/agents/DEMO-READINESS.md`](docs/agents/DEMO-READINESS.md) and [`handoff.md`](handoff.md).
