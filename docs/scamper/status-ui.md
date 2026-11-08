# Scamper UI worker

Branch: `scamper/ui`. Contract dependency: `c8d5139` (G0). Development: `http://localhost:3002`.

## Implemented slices

- Start page and `/play`: conversation, authoritative public balance/activity, payment inspection and confirm-approval dialog, rejection, independently sourced trusted contact and disclosed facts.
- One `GameAdapter` interface: fixture storyboard by default; `?adapter=api` selects the frozen same-origin routes through `apiRequest` and response schemas. No owner IDs, server modules, browser scoring or ledger calculations.
- Request lock, bounded message input, loading, request-reference errors, retry with the same actionId/body. Version conflicts refetch and require a new reviewed decision. Pending opponent turns recover via server GET.
- Outcome flags, server debrief/score/evidence IDs, optional reflection, event selection using returned replay snapshots, server reconstruction status, checkpoint fork and restart.
- Desktop panels and mobile Phone/Bank/Contacts controls. Existing kit APIs unchanged; feature styles reuse kit colors/spacing. Artwork replacement slots: `garden-scene` on the start page and `goal-portrait` in the goal card. No designer-owned files changed.

## Fixture versus real

Default is explicitly a **snapshot walkthrough**, not an authoritative game. It selects only committed public views. Custom message text is not echoed as an invented event. Verify and reject advance to prepared snapshots, including the authored protected branch. Fixture lineage/sequence jumps are not proof of server branching. Loss replay alone is provided. Safe exit, rejected-before-verification, reflection, and other replay paths report an explicit unsupported-snapshot error.

API adapter is implemented but **not connected to a real backend in this worktree**. Browser API tests intercept the network with public fixture responses; they are transport/UI evidence, not integration acceptance. Integration step 5 remains dependent on the integrator supplying the routes.

## Actual checks

- Initial `pnpm check`: failed on React effect/ref lint rules; fixed. Next run stopped at missing generated Prisma client. `pnpm exec prisma generate`: exit 0; generated locally only, no database mutation or migrations. Subsequent `pnpm check`: exit 0, lint/typecheck pass, **111 tests pass / 6 files**.
- Initial Playwright startup: sandbox bind denied on 3202. Approved retry exposed nested config working-directory issue, then CommonJS/import.meta mismatch. Both fixed locally in the UI-owned config.
- First executed browser run: **1 pass / 1 fail**; mobile test locator collided with Next's route announcer. Scoped the locator; rerun **2/2 pass**.
- `pnpm exec playwright test --config tests/e2e/game/playwright.ui.config.ts`: latest **4/4 pass**, including fixture desktop/mobile, mocked API identical-body retry, fallback label, and conflict refetch. Page-error listeners in desktop and API retry flows observed none. Mobile checks no horizontal overflow. Screenshot assertions are separate from behavioral assertions.
- `pnpm build`: sandbox run stalled during optimized compilation and was canceled (exit 130). Approved retry with network access **exit 0**: production compilation, TypeScript, static generation including `/` and `/play` pass. Existing next/font dependency downloads fonts at build time.
- Shared `pnpm test:integration`: not run; it starts backend port 3100 and uses database-backed auth/API tests, outside this fixture UI checkpoint. UI config starts its own server on **3202** and uses `.artifacts/ui/` instead.

## Local screenshots and artifacts

Latest run JSON: `.artifacts/ui/results.json`. Screenshot paths (after the named state assertions):

- `.artifacts/ui/playwright/experience-fixture-loss-ev-76ac7-eparate-checkpoint-practice/payment-inspection.png`
- `.artifacts/ui/playwright/experience-fixture-loss-ev-76ac7-eparate-checkpoint-practice/loss-replay.png`
- `.artifacts/ui/playwright/experience-fixture-loss-ev-76ac7-eparate-checkpoint-practice/protected-practice.png`
- `.artifacts/ui/playwright/experience-mobile-devices--9366b-rted-path-error-and-restart/mobile-bank.png`
- `.artifacts/ui/playwright/experience-mobile-devices--9366b-rted-path-error-and-restart/mobile-contacts.png`
- `.artifacts/ui/playwright/api-adapter-API-transport--db373-and-pending-controls-locked/api-mocked-fallback.png`

Visually inspected desktop inspection and mobile bank captures: readable panel boundaries, controls, wrapped text, and no horizontal clipping. Artifacts are local and uncommitted. Existing Discord hook inspected; `DISCORD_WEBHOOK_URL` absent in launcher environment, so no notification sent.

## Dependencies / next task

1. Integrator supplies frozen API implementation; exercise `/play?adapter=api` with real scripted and live sessions on 3002. Verify same-origin acceptance uses the actual localhost:3002 origin. Current config allows loopback dev origins; existing `BETTER_AUTH_URL` naming was inspected without reading env values.
2. Request to contract owner: add public fixture snapshots for safe exit, verified pre-payment decision in a fork, rejection before verification, submitted reflection, and protected replay. These enable complete deterministic UI preview without fabricating events or scores. Current consumers: fixture adapter and UI browser tests. No change to frozen schemas requested.
3. Re-run both real outcome paths, pending recovery, restart, replay and actual fork. Check parent unchanged and new session ID from server. These are not yet verified against a real server.
4. Next dev automatically appended its feedback instructions to AGENTS.md. This is an out-of-ownership generated change, left unstaged for integrator review.

## Integration handoff

- UI implementation commit: `773aaf3`, depends on G0 `c8d5139`. Test suite and final status follow in a separate focused commit.
- Changed implementation paths: `src/app/page.tsx`, `src/app/play/page.tsx`, `src/features/game/{adapter.ts,game-experience.tsx,game.module.css}`. Tests: `tests/components/game/adapter.test.tsx`, `tests/e2e/game/{playwright.ui.config.ts,experience.spec.ts,api-adapter.spec.ts}`. Status: this file.
- After final transcript auto-scroll change, reran `pnpm check` (**111/111**, exit 0) and the isolated Playwright command (**4/4**, exit 0). Latest captures reflect that change. No shared contract, backend, schema, package, lockfile, shared config, component API, or artwork edits.
- No push, deploy, cross-worktree edits, backend merge, database migration, or cleanup performed. Git needed approved access solely to this worktree's externally stored Git metadata.
