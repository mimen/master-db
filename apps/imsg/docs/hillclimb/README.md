# Comma hill climb

Goal, from Milad on 2026-10-09: loading is faster, every interaction is optimistic, and the app feels instant and smooth. Method: Anthropic's "How we made Claude.ai faster" and the pstack hillclimb playbook. One change, one measurement, keep or revert. Every kept win gets a CI ratchet.

Records in this directory:

- [CHANGELOG.md](CHANGELOG.md) has one entry per landed change, newest first.
- [decisions.tsv](decisions.tsv) has one row per attempt, kept or reverted.
- [interactions.md](interactions.md) is the inventory of every write or wait in the client.

## Metrics

All benchmarks live in `apps/imsg/e2e/bench/` and run from `apps/imsg`. `e2e/bench/queries.ts` prints Convex payload bytes per query during a cold load. Ratchets live in `e2e/fixture/ratchet.playwright.ts` and run in `validate-imsg.yml`.

To A/B a change on real data without touching production: `bun run deploy:branch` deploys the branch as a UI-only preview on its own port that reads production Convex, then run the prod benchmarks with `--url <preview URL>`, interleaved with runs against production. Fixture runs need `bun run fixture:start` (port 8399). Production runs are read-only: they open a conversation with the glide key `j`, which previews without marking read, and they send nothing.

| # | Metric | Command | Baseline (2026-10-10) | Current | Target | Ratchet |
|---|---|---|---|---|---|---|
| 1a | Cold load, first visit: navigation to an interactive conversation row, p75 | `bun e2e/bench/load.ts --target fixture --visit first --runs 9` | fixture 525 ms; prod 1,236 to 1,486 ms | prod 864 to 895 ms (H1 live, fb3bc9f8) | fixture ≤ 350 ms; prod ≤ 700 ms | Contacts not mounted at boot (ratchet.playwright.ts) |
| 1b | Cold load, returning visit (HTTP cache and list snapshot present), p75 | `bun e2e/bench/load.ts --target fixture --runs 9` | fixture 228 ms; prod 179 to 180 ms | same | ≤ 200 ms on both | none yet |
| 1c | Open a conversation to its newest message on screen, immediately after load, p75 | same command, `openP75` | fixture 128 ms; prod 529 to 581 ms (return visit) | same | prod ≤ 150 ms | none yet |
| 1d | JS on the wire, first visit | same command, `jsKB` | 721 KB fixture (br), 740 KB prod (br); 3.7 MB raw | same | ≤ 450 KB | none yet |
| 2 | Non-optimistic interactions (WAIT + SPINNER + PARTIAL in the inventory) | [interactions.md](interactions.md) | 84 of 104 (54 WAIT, 21 SPINNER, 9 PARTIAL) | 80 of 104 (51 WAIT, 21 SPINNER, 8 PARTIAL) | 0 for writes the user can see | none yet |
| 3a | Layout shifts after first paint, not caused by input, in named regions | `bun e2e/bench/shift.ts --target fixture --runs 5 --visit return` | fixture median 8; prod median 16 | same | 0 | none yet |
| 3b | Dropped frames scrolling a long thread / during stream-in; input lag while typing | not built yet | — | — | 0 long frames over 16.7 ms at p95 | none yet |
| 4 | Feel: flows walked in light and dark at desktop and phone sizes | manual walk, findings logged in decisions.tsv | not walked | — | no flash, jump, or missing pending state | — |

### How each benchmark tracks what a user feels

- **load.ts list time** runs from navigation start to the first animation frame in which a conversation row exists and has React handlers attached. A follow-up hover confirms the row responds. Before the reading, the script confirms that a row the user can act on is on screen.
- **load.ts open time** runs from the input (row click on the fixture, `j` on production) to the first frame in which the newest message bubble intersects the viewport. On the fixture, the bubble must also match the row's last-message text, so a stale or wrong thread fails the run instead of producing a number.
- **Network.** Fixture runs are shaped to a tailnet-like link (60 ms latency, 40 Mbit down) in Chromium. Production runs go over the real tailnet from the laptop. The fixture serves Convex through HTTP polling every 500 ms, not a WebSocket. Fixture open times therefore track client render cost, and production open times track the network and query path.
- **Correlation check.** Production first-visit list time (about 1 s) against return-visit time (about 175 ms) matches what a user sees between a fresh browser and a reopened PWA. Production open right after load (about 450 to 580 ms) against open after 8 s idle (about 200 to 250 ms) shows that the open is queued behind the list's background pagination. That finding drives the first hypotheses.

### Baseline evidence (2026-10-10, laptop M5, prod web SHA f4cef84b)

- **First-visit cold load on production** spends about 180 ms on HTML and the 740 KB brotli bundle. The Convex socket opens at about 225 ms, but `Connect` and the first queries go out only at about 578 ms, after the `/api/convex-token` response (requested at 181 ms, answered at 275 ms) and SDK auth setup. The first page of 25 conversations arrives at about 878 ms as a single 566 KB transition.
- **Background pagination** then loads every conversation in pages of 100: about 1.8 MB over 40 query updates in the first 8 seconds. `identity/queries:listPeople` adds 440 KB at boot. Both compete with a conversation open on the same socket, which is why an open right after load takes about twice as long as an open after idle.
- **Layout shift** on load comes from the queue header. The search input loses 14 px of width and the lens chips (Unread, Waiting, All) move right by 21 to 44 px when counts and an icon arrive after first paint. "Select a conversation" in the empty thread pane moves down 24 px. On production with a warm snapshot, the conversation list also shifts once.
- **Regression gate.** `bun run typecheck:imsg`, `bun run lint` (0 errors), `bun test` (1,028 pass at baseline) and the fixture e2e suite `bun run e2e:fixture` (75 of 75 since 2026-10-10). The e2e suite had 3 stale failures on main before this run. Two asserted behavior that deliberate changes had replaced: the unknown-outcome toast copy (61cc8615) and the one-tab-stop row (228f98f4). One indexed buttons that a hover reveals. Three more tests counted conversation rows while the list was still rendering batches, which H1's faster boot exposed. All six are fixed in the tests, and `settledCount` in `e2e/fixtures/desk.ts` waits for the list to stop growing.
