# Pending send

A message that has not gone out yet keeps its bubble. When the Mini is away or the browser is offline, the bubble says "Waiting to send" at once, with Cancel; when the Mini is up but has not taken the send, it says so after a second. Cancel removes the bubble and its outbox row, and the message never goes out. When the Mini or the connection comes back, the waiting send goes out. A send nothing takes within the Not sent deadline says "Not sent" with Retry, stays unsent when the Mini returns, and goes out only when the user taps Retry.

## Sub-features

- `pending-mini-away` shows Waiting to send within 1.5 s of Enter while the Mini is away, and the stored row has `sendState: "queued"`.
- `pending-cancel` removes a queued send's bubble, and `comma/outbox:outboxStatusFor` no longer knows its clientKey.
- `pending-reconnect` sends the waiting message once the Mini returns; its stored row becomes an `out-` guid.
- `pending-not-sent` turns a send into Not sent at the deadline (`sendState: "notSent"`), keeps it unsent when the Mini returns, and Retry sends it through `comma/pendingSends:retrySend`.
- `pending-offline` holds a send on the device while the browser is offline, with no enqueue, and enqueues it on reconnect.
- `pending-reload` keeps a held send in localStorage (`imsg.pendingSend.v1:<clientKey>`), redraws it with Waiting to send after a reload, and enqueues it exactly once under its original clientKey on reconnect.
- `pending-cancel-reload` cancels a restored send; the record is gone, a second reload does not bring it back, and nothing is enqueued online.
- `pending-caption` shows Waiting about a second after Enter while the Mini heartbeats but does not take the send, never shows it for a healthy send whose enqueue takes 600 ms, and says Sending… once the Mini takes the stuck send.

## How to get to it (user POV)

- Open Alex Rivera with the Mac mini unreachable, type a message and press Enter.
- Take the laptop offline, type a message and press Enter.

## Driving it with Playwright (desk fixture)

The drive is `apps/imsg/e2e/fixture/golden-pending-send.playwright.ts`. It records every send enqueue and every `comma/pendingSends:*` call.

- **Mini away.** POST `/__fixture/mini {"online":false}`. The fixture's outbox then holds sends as queued, and the bridge heartbeat reads ten minutes stale, so the client knows at once. Send, expect `Waiting to send`, click `Cancel sending`, then send again and POST `{"online":true}`.
- **Not sent.** POST `/__fixture/mini {"online":false,"notSentAfterMs":3000}` to shorten the deadline, send, wait for `Not sent`, bring the Mini back, then click `Retry sending`.
- **Offline.** `page.context().setOffline(true)`. The fixture's Convex client reads `navigator.onLine` as its socket state. Send, expect `Waiting to send` and no enqueue, then `setOffline(false)`.
- **Offline across a reload.** `setOffline` would also block the reload, so the drive overrides `navigator.onLine` with an init script that reads a localStorage flag (`deviceSwitch` in the drive). Flip the flag and dispatch `offline`, send, `page.reload()`, then flip it back and dispatch `online`.
- **Mini up but slow.** POST `/__fixture/mini {"online":false,"heartbeat":true}`: the outbox holds sends while the bridge heartbeat stays fresh, so only the one-second timer can show Waiting.

## Gotchas

- A queued send with the Mini heartbeating says Waiting to send after 1 s, timed from the bubble's mount; a drive that wants the immediate caption takes the Mini away (`heartbeat` follows `online` unless given).
- The fixture's client polls live queries every 500 ms, so a claim shows up to half a second late.
- The device-side deadline for an offline send is the real `NOT_SENT_AFTER_MS` (three minutes); `pending-sends.test.ts` covers it with fake timers.
- Other commands (typing, suggestions) also enqueue while you type. Filter enqueues by `payload.kind === "send"`.
