# Comma's Gmail connection

Comma reads two mailboxes, each through its own OAuth app:

- The Google Workspace mailbox, `milad@afternoonumbrellafriends.com`, connects through an internal app in the Cloud project `comma-auf`, owned by the `afternoonumbrellafriends.com` organization. An internal app serves only that Workspace's users. Google does not review it, and its refresh tokens do not expire on a timer. Its client is `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- The gmail.com mailbox, `miladmaaan@gmail.com`, cannot use an internal app. It connects through a second, external app in Testing mode, in its own project, `comma-personal`. A project has one consent-screen audience, so the external app cannot share the internal app's project. Google ends a Testing-mode grant 7 days after consent, so this mailbox needs a reconnect every week until Google verifies the app. Its client is `GOOGLE_PERSONAL_CLIENT_ID` and `GOOGLE_PERSONAL_CLIENT_SECRET`, and its push topic is `GMAIL_PERSONAL_PUSH_TOPIC`.

Settings has a row for each: **Gmail** and **Personal Gmail**. Connect names the app, the OAuth state carries it to the callback, and the mailbox's account row stores it with the grant time (`gmailGrant`), so every refresh uses the same client. For the personal mailbox, Settings counts down to the weekly reconnect. With both connected, Mail shows a chip per mailbox (All, AUF, Personal), and a reply goes out from the mailbox its thread belongs to.

The scopes are `openid email https://www.googleapis.com/auth/gmail.modify`, listed once in `GMAIL_SCOPES` (`convex/comma/googleAuth.ts`). The consent screen must list the same scopes. `gmail.modify` reads mail and labels, sends, and archives.

Comma's Gmail lane (`convex/comma/gmailLane.ts`) sends a reply as RFC 822 with the replied message's Message-ID in In-Reply-To and References and the thread's id, so it threads in Gmail. It sets its own Message-ID, `<comma.<clientKey>@<mailbox domain>>`, but Gmail replaced it with its own on both the Workspace and the gmail.com mailbox when this was checked on 2026-11-09. When a send's answer is lost, Comma searches for that Message-ID at 20 seconds and 2 minutes, then for a Sent message in the thread with the same subject and text. The text match is the check that finds it in practice, so the send lands without going out twice. Settling a thread in Comma removes its Inbox label; unsettling adds it back. If Gmail refuses, Comma takes the settle back and shows Gmail's error above the thread.

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
   - Reply to that message from Comma's Mail reader. The reply shows in Gmail's own thread, not as a new conversation, and its headers (Gmail's **Show original**) carry an `In-Reply-To` naming the message it answered.
   - Archive a thread from Comma. It leaves Gmail's Inbox, and Comma's cleared count rises by one, not two.
   - Open Mail. A newsletter shows only under All inbox, never under People.
   - Send the mailbox an HTML message with a `<script>` and a 1×1 remote image. The reader shows neither. Other remote images load at once from a known sender, or from a mailing list on three or more inbox threads; from a stranger or spam they wait for **Load images** (`loadsRemoteImages` in `shared/platform-profile.ts`).

## The personal app (gmail.com)

Run these after the Workspace setup above. The commands use the project id `comma-personal`; pick another if it is taken, and use it everywhere it appears.

1. Create the project, outside any organization, and turn on the Gmail and Pub/Sub APIs:

   ```bash
   gcloud projects create comma-personal --name "Comma Personal"
   gcloud services enable gmail.googleapis.com pubsub.googleapis.com --project comma-personal
   ```

2. In the Cloud console (<https://console.cloud.google.com/auth/overview?project=comma-personal>), set up the Google Auth Platform:
   - **Branding**: app name `Comma`, support email `miladmaaan@gmail.com`.
   - **Audience**: User type **External**, publishing status **Testing**. Under **Test users**, add `miladmaaan@gmail.com`. Only test users can consent while the app is in Testing.
   - **Data access**: add the same scopes as the Workspace app: `openid`, `.../auth/userinfo.email` and `https://www.googleapis.com/auth/gmail.modify`.
3. Under **Clients**, choose **Create client**, then **Web application**, and name it `Comma Convex`. Add exactly one authorized redirect URI, the same one as the Workspace app: `https://shiny-gerbil-853.convex.site/comma/oauth/google/callback`. Copy the client ID and client secret into a new 1Password item in `Sol` named `Comma Gmail Personal App`, and add the item to the credential map.
4. Gmail publishes a mailbox's changes only to a topic in its OAuth app's project, so the personal mailbox needs its own topic. The push subscription lives in `comma-auf` and attaches to that topic across projects, so it pushes with the same service account and audience that Convex already checks:

   ```bash
   gcloud pubsub topics create comma-gmail --project comma-personal
   gcloud pubsub topics add-iam-policy-binding comma-gmail --project comma-personal \
     --member serviceAccount:gmail-api-push@system.gserviceaccount.com --role roles/pubsub.publisher
   gcloud pubsub subscriptions create comma-gmail-personal-push --project comma-auf \
     --topic projects/comma-personal/topics/comma-gmail \
     --push-endpoint https://shiny-gerbil-853.convex.site/comma/gmail/push \
     --push-auth-service-account comma-gmail-push@comma-auf.iam.gserviceaccount.com \
     --push-auth-token-audience https://shiny-gerbil-853.convex.site/comma/gmail/push \
     --ack-deadline 10
   ```

   Without the topic, the personal mailbox still syncs, through the 5-minute backstop alone.
5. Set the Convex environment variables on production:

   ```bash
   export CONVEX_DEPLOYMENT=dev:shiny-gerbil-853
   bunx convex env set GOOGLE_PERSONAL_CLIENT_ID "$(op read 'op://Sol/Comma Gmail Personal App/client id')"
   bunx convex env set GOOGLE_PERSONAL_CLIENT_SECRET "$(op read 'op://Sol/Comma Gmail Personal App/client secret')"
   bunx convex env set GMAIL_PERSONAL_PUSH_TOPIC projects/comma-personal/topics/comma-gmail
   ```

6. Connecting starts the backfill, so confirm with Milad first. In Comma, open **Settings**, then **Accounts**, then **Connect Personal Gmail**, and approve as `miladmaaan@gmail.com`. Google warns that the app is unverified; continue past the warning. Settings shows the mailbox with "Reconnect within 7 days".
7. Check the result: send `miladmaaan@gmail.com` a message, and it shows in Mail under the **Personal** chip within a minute. Reply from Comma, and Gmail's **Show original** shows `From: miladmaaan@gmail.com`.

Every week, Settings counts down. Choose **Reconnect** on **Personal Gmail** before the count ends. Reconnecting runs the same consent and restarts the 7 days. If the count ends first, the next refresh fails with `invalid_grant` and the mailbox shows **Reconnect**, as below. Mail already in Comma stays. New mail waits in Gmail, and the backfill that every connect starts reads it.

## When Google refuses the token

If a refresh fails (`invalid_grant`, for example after a password reset or a revoked grant), the account's health becomes `needsAttention`, its executor status row reads "Reconnect Gmail in Settings", and Settings shows **Reconnect**. Reconnecting runs the same consent and replaces the sealed token.
