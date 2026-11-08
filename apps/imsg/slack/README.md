# Comma's Slack app

Comma reads the AUF workspace (`umbrellafriends`, team `T066U9Q8F99`) as Milad, through a user token on a custom app named Comma that lives inside the workspace. `manifest.json` is the app's whole configuration. It has user scopes only: Comma has no bot user and asks for no bot scopes. Token rotation stays off, so the user token never expires and nothing refreshes it.

The write scopes (`chat:write`, `reactions:write`, `*:write`, `files:write`) are for sending, which lands after S1. They are in the manifest now so one install covers both milestones.

The app subscribes, on Milad's behalf, to messages in DMs, group DMs, public and private channels, and to profile changes. Slack posts them to `POST /comma/slack/events`, signed with the app's signing secret. Comma keeps every DM and group DM message, the threads Milad started, replied in or is mentioned in, and top-level messages in channels listed on the account's `slackChannels`; everything else is dropped before any write. Reaction and read-marker events are not subscribed: Comma shows Slack reactions with sending, and Slack sends read markers only over RTM.

## Setup

Run these in order from the repo root. Comma's production is the Convex deployment `dev:shiny-gerbil-853` (production despite the prefix), whose site is `https://shiny-gerbil-853.convex.site`. Never use `--prod`: it names a different deployment.

1. Deploy the Convex functions that serve the URLs in `manifest.json` with `CONVEX_DEPLOYMENT=dev:shiny-gerbil-853 bunx convex dev --once`, then check that the events URL answers: `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://shiny-gerbil-853.convex.site/comma/slack/events` prints `500` until the signing secret is set (step 5) and `401` after. A `404` means the route is not deployed.
2. Create the app at <https://api.slack.com/apps> with **Create New App**, then **From an app manifest**. Pick the `umbrellafriends` workspace and paste `manifest.json`. Slack verifies the events URL only once the signing secret is set, so if it reports the URL as unverified, finish step 5 and press **Retry** on the app's **Event Subscriptions** page.
3. On the app's **Basic Information** page, copy the Client ID, the Client Secret and the Signing Secret into a new 1Password item in `Sol` named `Comma Slack App`. Add the item to the credential map.
4. Generate the token key and store it in the same item as `COMMA_TOKEN_KEY`:

   ```bash
   echo "1:$(openssl rand -base64 32)"
   ```

5. Set the Convex environment variables on production:

   ```bash
   export CONVEX_DEPLOYMENT=dev:shiny-gerbil-853
   bunx convex env set SLACK_CLIENT_ID "$(op read 'op://Sol/Comma Slack App/client id')"
   bunx convex env set SLACK_CLIENT_SECRET "$(op read 'op://Sol/Comma Slack App/client secret')"
   bunx convex env set COMMA_TOKEN_KEY "$(op read 'op://Sol/Comma Slack App/COMMA_TOKEN_KEY')"
   bunx convex env set SLACK_SIGNING_SECRET "$(op read 'op://Sol/Comma Slack App/signing secret')"
   ```

6. In Comma, open **Settings**, then **Accounts**, then **Connect** beside Slack, and approve the install as Milad. The tab ends on "Slack is connected", and Settings shows the workspace as connected. Connecting starts the 90-day backfill, which paces itself under Slack's rate limits; its progress is the `slack:backfill` row in `comma_sync_state` (`step` reaches `done`).
7. Send Milad a Slack DM from another account. It shows in Comma's Messages within seconds.

To keep a channel's top-level messages, add its id to the account's `slackChannels` and reconnect, which reruns the backfill. Settings gains the opt-in in S3.

## Rotating the token key

Set `COMMA_TOKEN_KEY` to a new version (`2:<base64>`), then reconnect Slack from Settings. A token sealed under the old version no longer opens, so Comma stops reading Slack until the reconnect.
