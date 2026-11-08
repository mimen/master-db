# Comma's Gmail connection

Comma reads Milad's Google Workspace mailbox, `milad@afternoonumbrellafriends.com`, through an internal OAuth app in a Google Cloud project owned by the `afternoonumbrellafriends.com` organization. An internal app serves only that Workspace's users. Google does not review it, and its refresh tokens do not expire on a timer. A gmail.com mailbox cannot use an internal app; that is milestone G4.

The scopes are `openid email https://www.googleapis.com/auth/gmail.modify`, listed once in `GMAIL_SCOPES` (`convex/comma/googleAuth.ts`). The consent screen must list the same scopes. `gmail.modify` reads mail and labels now, and will send and archive in G2.

How the mailbox reaches Comma:

- `users.watch` publishes every mailbox change to a Pub/Sub topic. A push subscription posts each change to `POST /comma/gmail/push` with a Google-signed OIDC token for a service account. Convex checks the signature, issuer, audience and service-account email, then schedules a history sync from the stored historyId (`convex/comma/gmailPush.ts`, `gmailSync.ts`).
- A 5-minute cron (`comma-gmail-backstop`) runs the same sync, so mail that a push missed still lands. A daily cron (`comma-gmail-watch`) renews the watch, which lapses after 7 days.
- Connecting starts a paged backfill. It reads the inbox, then 90 days of threads outside spam and trash where Milad wrote or a participant resolves to a person. Its progress is the `gmail:backfill` row in `comma_sync_state`; the row's `steps` list is empty once it is done.

## Setup

Run these in order. Comma's production is the Convex deployment `dev:shiny-gerbil-853` (production despite the prefix), whose site is `https://shiny-gerbil-853.convex.site`. Never use `--prod`: it names a different deployment. The commands below use the project id `comma-auf`. Pick another id if that one is taken, and use it everywhere it appears.

1. Confirm that Milad administers the `afternoonumbrellafriends.com` Google Workspace (open question 2 in the plan). An internal app needs a Cloud project inside that organization. If he is not an admin, stop: the mailbox would need an external app with a weekly reconnect, which this setup does not cover.
2. Deploy the Convex functions from the repo root with `CONVEX_DEPLOYMENT=dev:shiny-gerbil-853 bunx convex dev --once`. Then check both URLs:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://shiny-gerbil-853.convex.site/comma/gmail/push
   curl -s -o /dev/null -w '%{http_code}\n' https://shiny-gerbil-853.convex.site/comma/oauth/google/callback
   ```

   The push URL prints `500` until `GMAIL_PUSH_SERVICE_ACCOUNT` is set (step 7) and `401` after. The callback prints `400`. A `404` from either means the route is not deployed.
3. Create the project inside the organization and turn on the Gmail and Pub/Sub APIs:

   ```bash
   gcloud organizations list   # the afternoonumbrellafriends.com organization's id
   gcloud projects create comma-auf --name "Comma" --organization <ORG_ID>
   gcloud services enable gmail.googleapis.com pubsub.googleapis.com --project comma-auf
   ```

   If `pubsub.googleapis.com` asks for billing, link a billing account to the project. The push volume stays inside Pub/Sub's free tier.
4. In the Cloud console (<https://console.cloud.google.com/auth/overview?project=comma-auf>), set up the Google Auth Platform:
   - **Branding**: app name `Comma`, support email `milad@afternoonumbrellafriends.com`.
   - **Audience**: User type **Internal**.
   - **Data access**: add the scopes `openid`, `.../auth/userinfo.email` and `https://www.googleapis.com/auth/gmail.modify`.
5. Under **Clients**, choose **Create client**, then **Web application**, and name it `Comma Convex`. Add exactly one authorized redirect URI: `https://shiny-gerbil-853.convex.site/comma/oauth/google/callback`. Copy the client ID and client secret into a new 1Password item in `Sol` named `Comma Gmail App`, and add the item to the credential map.
6. Create the topic, let Gmail publish to it, and create the push subscription with an authenticated service account:

   ```bash
   gcloud pubsub topics create comma-gmail --project comma-auf
   gcloud pubsub topics add-iam-policy-binding comma-gmail --project comma-auf \
     --member serviceAccount:gmail-api-push@system.gserviceaccount.com --role roles/pubsub.publisher
   gcloud iam service-accounts create comma-gmail-push --display-name "Comma Gmail push" --project comma-auf
   gcloud pubsub subscriptions create comma-gmail-push --project comma-auf --topic comma-gmail \
     --push-endpoint https://shiny-gerbil-853.convex.site/comma/gmail/push \
     --push-auth-service-account comma-gmail-push@comma-auf.iam.gserviceaccount.com \
     --push-auth-token-audience https://shiny-gerbil-853.convex.site/comma/gmail/push \
     --ack-deadline 10
   ```

   If the organization enforces domain-restricted sharing (`iam.allowedPolicyMemberDomains`), the publisher grant to `gmail-api-push@system.gserviceaccount.com` fails. Allow that member in a project-level override of the policy, then run the grant again. The audience must be the push URL exactly, because Convex compares the token's `aud` against it.
7. Set the Convex environment variables on production. `COMMA_TOKEN_KEY` is already set for Slack and seals Gmail's tokens too.

   ```bash
   export CONVEX_DEPLOYMENT=dev:shiny-gerbil-853
   bunx convex env set GOOGLE_CLIENT_ID "$(op read 'op://Sol/Comma Gmail App/client id')"
   bunx convex env set GOOGLE_CLIENT_SECRET "$(op read 'op://Sol/Comma Gmail App/client secret')"
   bunx convex env set GMAIL_PUSH_TOPIC projects/comma-auf/topics/comma-gmail
   bunx convex env set GMAIL_PUSH_SERVICE_ACCOUNT comma-gmail-push@comma-auf.iam.gserviceaccount.com
   ```

8. Connecting starts the backfill against production data, so confirm with Milad before this step. In Comma, open **Settings**, then **Accounts**, then **Connect Gmail**, and approve as `milad@afternoonumbrellafriends.com`. The tab ends on "Gmail is connected", and Settings shows the mailbox as connected.
9. Check the result:
   - Send the mailbox a message from another account. It shows in Mail within a minute.
   - Archive a thread in Gmail. Comma settles it.
   - Open Mail. A newsletter shows only under All inbox, never under People.
   - Send the mailbox an HTML message with a `<script>` and a 1×1 remote image. The reader shows neither, and holds other remote images until **Load images**.

## When Google refuses the token

If a refresh fails (`invalid_grant`, for example after a password reset or a revoked grant), the account's health becomes `needsAttention`, its executor status row reads "Reconnect Gmail in Settings", and Settings shows **Reconnect**. Reconnecting runs the same consent and replaces the sealed token.
