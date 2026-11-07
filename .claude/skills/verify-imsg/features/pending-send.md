# Pending send

A message that has not gone out yet keeps its bubble. When the Mini is away or the browser is offline, the bubble says "Waiting to send" at once, with Cancel. Cancel removes the bubble and its outbox row, and the message never goes out. When the Mini or the connection comes back, the waiting send goes out. A send nothing takes within the Not sent deadline says "Not sent" with Retry, stays unsent when the Mini returns, and goes out only when the user taps Retry.

## Sub-features

- `pending-mini-away` shows Waiting to send within 1.5 s of Enter while the Mini is away, and the stored row has `sendState: "queued"`.
- `pending-cancel` removes a queued send's bubble, and `comma/outbox:outboxStatusFor` no longer knows its clientKey.
- `pending-reconnect` sends the waiting message once the Mini returns; its stored row becomes an `out-` guid.
- `pending-not-sent` turns a send into Not sent at the deadline (`sendState: "notSent"`), keeps it unsent when the Mini returns, and Retry sends it through `comma/pendingSends:retrySend`.
- `pending-offline` holds a send on the device while the browser is offline, with no enqueue, and enqueues it on reconnect.

## How to get to it (user POV)

- Open Alex Rivera with the Mac mini unreachable, type a message and press Enter.
- Take the laptop offline, type a message and press Enter.

## Driving it with Playwright (desk fixture)

The drive is `drives/pending-send.ts`. It records every send enqueue and every `comma/pendingSends:*` call.

- **Mini away.** POST `/__fixture/mini {"online":false}`. The fixture's outbox then holds sends as queued, and the bridge heartbeat reads ten minutes stale, so the client knows at once. Send, expect `Waiting to send`, click `Cancel sending`, then send again and POST `{"online":true}`.
- **Not sent.** POST `/__fixture/mini {"online":false,"notSentAfterMs":3000}` to shorten the deadline, send, wait for `Not sent`, bring the Mini back, then click `Retry sending`.
- **Offline.** `page.context().setOffline(true)`. The fixture's Convex client reads `navigator.onLine` as its socket state. Send, expect `Waiting to send` and no enqueue, then `setOffline(false)`.

## Gotchas

- A queued send with the Mini up says nothing for 1.5 s, then Sending…, and Waiting to send only after 4 s, so a drive that wants the immediate caption must take the Mini away first.
- The device-side deadline for an offline send is the real `NOT_SENT_AFTER_MS` (three minutes); `pending-sends.test.ts` covers it with fake timers.
- Other commands (typing, suggestions) also enqueue while you type. Filter enqueues by `payload.kind === "send"`.
