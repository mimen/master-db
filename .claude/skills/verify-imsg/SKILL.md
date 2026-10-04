---
name: verify-imsg
description: Drive the imsg (Comma) messaging client in a real browser against its local fixture world, and capture proof that a feature works. Use after changing anything in apps/imsg (client, bridge commands, Convex comma functions) to prove a user-visible behavior end to end, or when asked to "verify", "prove it works", or "drive the app". Covers the web client; the desktop shell and Expo Go have their own launchers (see Scope).
---

# Verify imsg

imsg is a messaging client: an Expo web app that reads and writes through Convex, with a Mac Mini "bridge" that executes queued commands against iMessage. Verification runs the **fixture**: the real web bundle served by an in-process copy of the Mini server, with a fake BlueBubbles, a seeded fixture world, and a fake Convex endpoint (`/__fixture/convex`) answering every query and command from that world. Nothing touches production, real iMessage, or the Convex deployment.

Scripts live in `.claude/skills/verify-imsg/scripts/`. Feature recipes live in [features/](features/README.md). Ready-made drives live in `drives/`.

## Scope

- **Covered:** the web client, through the fixture at `http://127.0.0.1:8399`.
- **Not covered here:** the Tauri desktop shell (`bun run dev:desktop` from `apps/imsg`), Expo Go on a phone, and production. To check production's route surface and Convex auth, run `bun apps/imsg/scripts/verify-convex-only.ts`. It is read-only against the live Mini.

## Launch

```bash
.claude/skills/verify-imsg/scripts/launch.sh             # install deps, build the fixture bundle, start, wait for health
.claude/skills/verify-imsg/scripts/launch.sh --skip-build # reuse e2e/fixture/dist when the client is unchanged
```

- **Ready** when it prints `verify-imsg: ready at http://127.0.0.1:8399 (pid N, build SHA)`. The build takes 1-3 minutes; startup takes seconds.
- It records the pid, port and build SHA in `$TMPDIR/verify-imsg/`.
- It refuses to start if this skill already has an instance running, or if anything else holds port 8399. Never drive an instance this skill did not start.
- Override the port with `IMSG_FIXTURE_PORT=8400`.
- **One instance per checkout.** The fixture always writes its overlay DB to `apps/imsg/e2e/fixture/.runtime/`, so two instances in the same checkout corrupt each other. To run in parallel, use separate worktrees and separate ports.

## Doctor

```bash
.claude/skills/verify-imsg/scripts/doctor.sh
```

Read-only. It checks four things:
- our pid is alive
- port 8399 is owned by that pid
- `/api/health` answers
- the fixture bundle exists

It also warns if the instance was built from a different commit than HEAD. It exits non-zero on any failure. `drive.sh` runs it first; run it yourself whenever anything looks off.

## Drive

```bash
.claude/skills/verify-imsg/scripts/drive.sh <drive.ts> <feature-id>
# e.g.
.claude/skills/verify-imsg/scripts/drive.sh .claude/skills/verify-imsg/drives/send-text.ts send-text
```

A drive is one Playwright test file that imports the repo's own `desk` fixture:

```ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../fixtures/desk";
const evidence = process.env.VERIFY_IMSG_EVIDENCE!;

test("<feature-id>: <behavior>", async ({ desk }) => { /* desk.page, desk.request, desk.chats */ });
```

`drive.sh` stages the file into `apps/imsg/e2e/fixture/` for the run, runs it with the repo's fixture config (headless Chromium, 1440x900), and deletes the staged copy afterwards.

The `desk` fixture gives every drive four things:
- **A reset world.** It resets the fixture world before the drive (`POST /__fixture/reset`).
- **A Tauri stand-in.** The page runs as the desktop shell, through a fake Tauri global.
- **A Mini-call guard.** The drive fails if the client calls any Mini route other than `/api/convex-token`, `/api/deploy/status` or the desktop-release routes. Every drive therefore also proves the client stayed on Convex.
- **Peer helpers.** `desk.receive(chatGuid, text)` and `desk.setTyping(chatGuid, on)` simulate the other person.

**Stable handles.** Use these, not coordinates:

| Handle | What it is |
|---|---|
| `getByTestId("conversation-row").filter({ hasText: "Alex Rivera" })` | A sidebar row |
| `getByTestId("thread-view")` | The open thread |
| `getByTestId("thread-settle")` | The thread header's settle button |
| `getByTestId("triage-rail")`, `getByTestId("sweep-card")` | Triage UI |
| `getByPlaceholder("iMessage")` | The composer |
| `getByRole("button", { name: "Send", exact: true })` | Send |
| `getByRole("button", { name: "Schedule message" })` | Schedule |
| `getByRole("button", { name: "Record voice message" })` | Voice |
| `getByRole("button", { name: "Remove attachment" })` | A staged attachment |
| `getByRole("heading", { name: "Needs reply" })` | The queue headings |

**Fixture chats** (`desk.chats`):

| Key | Chat |
|---|---|
| `needs` | Alex Rivera, `iMessage;-;+16195550101`, last message inbound |
| `waiting` | `iMessage;-;+16195550102`, last message outbound |
| `unreadGroup` | Launch Crew |
| `coldSms` | An SMS chat |
| `unknown` | An unknown sender |

**Reading state as the client does.** POST `{ name, args }` to `/__fixture/convex` with the same Convex function the client calls. For example, `comma/queries:listMessages` with `{ conversationId, paginationOpts }`, or `comma/outbox:getCommand` with `{ commandId }`.

**Fixture time.** The server clock is pinned to `FIXTURE_NOW` (exported from `e2e/fixture/world.ts`). If a feature cares whether a message counts as fresh, shift the page clock with `page.addInitScript` the way `e2e/fixture/send.playwright.ts` does.

**Faults.** Inject one with `POST /__fixture/fault {"method":"sendText","error":"offline"}`, and clear it with `{"method":null}`. Control echo delay with `POST /__fixture/send-timing {"delayMs":3000,"echo":false}`.

## Evidence

Everything goes to `$TMPDIR/verify-imsg/evidence/<feature-id>/`:
- **`run.log`:** the Playwright output.
- **`playwright/`:** traces and failure screenshots.
- **Your own captures:** whatever the drive writes, using the `VERIFY_IMSG_EVIDENCE` env var.

A drive's proof must include:
- **The action and its end state.** Take a screenshot before acting and one after the UI settles. Some bubbles fade in, so poll for opacity 1 before the final screenshot (see `drives/send-text.ts`).
- **An ARIA snapshot** of the region that changed: `await region.ariaSnapshot()` written to `aria.txt`.
- **The side effect,** read back through a second view. That is the Convex command the client enqueued, captured from `/__fixture/convex` request bodies, plus the stored row re-read via a Convex query. A visible bubble alone is not proof the send went out.
- **The real user path.** Click and type the way a user does. Enqueueing a command directly through `/__fixture/convex` proves only the backend, never the feature.

The fixture's fake BlueBubbles and fake Convex are the production boundary. Do not mock anything inside the client.

## Cleanup

```bash
.claude/skills/verify-imsg/scripts/cleanup.sh
```

This stops only the pid `launch.sh` recorded, removes the run state and keeps `$TMPDIR/verify-imsg/evidence/`. Run it after every run, including failed ones, so a broken attempt does not leave port 8399 held. Never kill by process name: other sessions run their own Playwright Chromium and fixture servers.

## Gotchas

- **A stale install.** `fixture:build` failing with `Unable to resolve a valid config plugin for expo-image` means stale `node_modules`. `launch.sh` reinstalls from the lockfiles first; if you build by hand, run `bun install --frozen-lockfile` in the repo root, `apps/imsg` and `apps/imsg/client`.
- **The client bundle is baked in.** The fixture serves the built bundle, so after any client change, relaunch without `--skip-build`. Doctor's SHA warning catches a stale build.
- **A busy machine.** When it's loaded, the whole fixture suite takes about 20 minutes. Run one drive, not `bun run e2e:fixture`, unless you need full coverage.
