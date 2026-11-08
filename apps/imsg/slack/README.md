# Comma's Slack app

Comma reads the AUF workspace (`umbrellafriends`, team `T066U9Q8F99`) as Milad, through a user token on a custom app named Comma that lives inside the workspace. `manifest.json` is the app's whole configuration. It has user scopes only: Comma has no bot user and asks for no bot scopes. Token rotation stays off, so the user token never expires and nothing refreshes it.

The write scopes (`chat:write`, `reactions:write`, `*:write`, `files:write`) are for sending, which lands after S1. They are in the manifest now so one install covers both milestones.

## Setup

Run these in order from the repo root. Comma's production is the Convex deployment `dev:shiny-gerbil-853` (production despite the prefix), whose site is `https://shiny-gerbil-853.convex.site`. Never use `--prod`: it names a different deployment.

1. Deploy the Convex functions that serve the URLs in `manifest.json` with `CONVEX_DEPLOYMENT=dev:shiny-gerbil-853 bunx convex dev --once`. Slack checks them when the app is created.
2. Create the app at <https://api.slack.com/apps> with **Create New App**, then **From an app manifest**. Pick the `umbrellafriends` workspace and paste `manifest.json`.
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
   ```

6. In Comma, open **Settings**, then **Accounts**, then **Connect** beside Slack, and approve the install as Milad. The tab ends on "Slack is connected", and Settings shows the workspace as connected.

## Rotating the token key

Set `COMMA_TOKEN_KEY` to a new version (`2:<base64>`), then reconnect Slack from Settings. A token sealed under the old version no longer opens, so Comma stops reading Slack until the reconnect.
