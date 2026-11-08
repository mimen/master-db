# iMessage regression coverage

What keeps iMessage working while Slack and Gmail land. The `Validate imsg` workflow runs on every pull request that touches `apps/imsg/**` or `convex/**`, and its browser step runs every `*.playwright.ts` in `fixture/`. Paths below are relative to the repo root; `fixture/` is `apps/imsg/e2e/fixture/`.

| Behavior | Test | Runs in CI |
|---|---|---|
| Every kind the Mini's processes post to `/comma/ingest/<kind>` is in the Convex `ROUTES` table | `apps/imsg/server/bridge/fake-ingest.test.ts` scans `apps/imsg/server` for the posted kinds; `FakeIngest` answers a kind missing from `ROUTES` with the production 404, so every bridge unit test fails too | yes |
| Bridge startup (account), conversations, messages, attachments, unread, scheduled, sync, executor status, and a send claimed, executed and completed, against the real Convex functions | `convex/comma/bridgeContract.test.ts` (real `startBridge` and `ConvexIngest`, convex-test backend) | yes |
| Flat legacy message rows; a claim renewed and completed | `convex/comma/bridgeContract.test.ts` | yes |
| Agent runner round trip over the ingest routes | `convex/comma/agentContract.test.ts` | yes |
| Comma Convex functions (ingest, outbox, triage, queries, reactions, lanes) | `convex/comma/*.test.ts` under vitest | yes |
| Slack's profile: channel attention, no screening, every write greyed with its reason; the Service filter lists only platforms the inbox holds | `apps/imsg/shared/platform-profile.test.ts`, `apps/imsg/client/src/lib/inbox-model.test.ts` | yes |
| Slack conversation keys, kinds and routes; mrkdwn display and model text; the Slack lane refuses a send and completes a read in Convex | `convex/comma/conversationIdentity.test.ts`, `convex/comma/slackText.test.ts`, `convex/comma/slackLane.test.ts` | yes |
| Send a text | `fixture/golden-send-text.playwright.ts`, `fixture/smoke.playwright.ts`, `fixture/send.playwright.ts` | yes |
| A burst of sends keeps its order in the thread and the preview | `fixture/golden-send-burst.playwright.ts`, `fixture/send.playwright.ts` | yes |
| Pending send: Mini away, browser offline, Cancel, Not sent, Retry, reload | `fixture/golden-pending-send.playwright.ts` | yes |
| React, change and remove a tapback; a peer's come and go | `fixture/golden-reactions.playwright.ts`, `fixture/tapback-tray.playwright.ts` | yes |
| Emoji reactions sent and received; greyed when the Mac can't | `fixture/golden-emoji-reactions.playwright.ts` | yes |
| Settle and un-settle, Undo, auto-advance | `fixture/golden-settle-loop.playwright.ts` | yes |
| A settle right after a send anchors on that send and stays settled once it lands | `fixture/golden-settle-loop.playwright.ts` (client), `convex/comma/triage.test.ts` (Convex), `apps/imsg/client/src/hooks/use-triage-actions.test.ts` | yes |
| Mark read, and its rollback when BlueBubbles refuses | `fixture/ratchet.playwright.ts` | yes |
| Scheduled: send now and cancel, with rollback | `fixture/ratchet.playwright.ts` | yes |
| A group's CRM and details by conversation id | `fixture/golden-conversation-identity.playwright.ts` | yes |
| `/chat/<guid>` redirects to `/c/<id>` | `fixture/golden-conversation-identity.playwright.ts` | yes |
| A contact rename shows in the list, Today, the thread and group senders | `fixture/golden-contact-rename.playwright.ts` | yes |
| SMS greys reactions, Reply, Edit and Undo send, and Convex refuses them | `fixture/golden-platform-profile.playwright.ts` | yes |
| Suggestions arrive, on their own lane behind a send and a tapback | `fixture/golden-outbox-lanes.playwright.ts` | yes |
| Phone row swipe marks unread | `fixture/row-swipe.playwright.ts` | yes |
| Design-system primitive sizes | `fixture/ui-gallery.playwright.ts` | yes |
| Typing indicator, layout and theme matrix | `fixture/visual.playwright.ts` | yes |
| Slow suggestion deadline and timeout | `.claude/skills/verify-imsg/drives/suggestions-deadline.ts` | no, 43 s a run |
| Tapback, delete, mark read and Send later reaching the bridge | `.claude/skills/verify-imsg/drives/bridge-commands.ts` | no; the golden reactions drive and the ratchets cover them |

## Gaps

- **The deployed Convex.** CI proves the source's `ROUTES` table, not the deployment. Convex deploys separately, so a route the Mini needs must reach Convex before the merge that ships the Mini (see `AGENTS.md`, Convex architecture). After a Convex deploy, `bun apps/imsg/scripts/verify-convex-only.ts` checks production read-only.
- **Real BlueBubbles, iMessage, Expo Go and the Tauri shell.** The fixture fakes BlueBubbles; the shell and the phone have their own launchers.
- **Contract tests are not typechecked.** `bridgeContract.test.ts` and `agentContract.test.ts` need Bun's types, so `convex/tsconfig.json` excludes them; the imsg project checks the code they drive.
- **The fixture mirrors two Convex rules.** `fixture/triage.ts` copies `sameSend` and `carryTempAnchor` from `convex/comma/triage.ts`. The drive proves the client's anchor; `convex/comma/triage.test.ts` proves the real rule.

## Known failures

- **`agent-pane-shots` batch 3, the strip chips** (`.claude/skills/verify-imsg/drives/agent-pane-shots.ts`). Opening a conversation whose agent wants the user (asking, drafted, failed) opens the agent pane by itself (`desktop-shell-provider.tsx`), which hides the chip, and opening the pane marks a ready or failed chat seen, so closing it does not bring the chip back. The screenshot step needs a width below the wide shell or seeds it can capture before the pane opens. Not in CI.
- **The empty Unread lens says "Go to Needs you ⌘1".** Today became the first lens, so ⌘1 opens Today and Needs you is ⌘2 (`client/src/components/empty-lens.tsx`). It is not fixed here: main's first-visit JS sits 37 bytes under its 470,000-byte brotli ceiling, and changing that one character adds 250 bytes, so the fix needs a bundle trim with it.
