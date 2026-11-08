# Mail sending

The Mail reader replies and archives. **Reply** and **Reply all** open the email composer below the cards with To, Cc and subject filled as Gmail fills them. Enter adds a line, and ⌘Enter or **Send** sends. The send shows as a card at once and becomes Gmail's message in the same thread. **Archive** settles the thread, which leaves the inbox; **Move to Inbox** brings it back. When Gmail refuses an archive, the thread comes back and Gmail's error shows under the subject. An agent's draft for the thread opens the composer with its text and note.

## Sub-features

- `mail-reply`: Reply fills `Sam Lee <sam@venue.test>` and `Re: Load-in for Saturday`; Reply all adds `Dana Ortiz <dana@venue.test>` to Cc.
- `mail-send`: ⌘Enter sends a third card with "cc Dana Ortiz", and the enqueued payload carries `replyToGuid: "mv2"` and the `email` fields.
- `mail-unknown`: a lost answer shows "Not sure this went through. Check Sent in Gmail before sending again." until the check lands one card.
- `mail-archive`: Archive drops the thread from the list and shows Move to Inbox; Move to Inbox lists it again.
- `mail-archive-refused`: a refused archive shows "Gmail didn't archive this: …" as an alert and keeps the thread listed.
- `mail-agent-draft`: an agent draft opens the composer with its text and note; sending clears the draft.

## How to get to it (user POV)

Click **Mail** in the sidebar footer, click Sam Lee's thread, then **Reply**, **Reply all** or **Archive**.

## Driving it with Playwright (desk fixture)

The drive is `apps/imsg/e2e/fixture/mail-send.playwright.ts`. CI runs it with every fixture spec.

- The fixture's mailbox (`e2e/fixture/mail.ts`) runs the Gmail lane's rules: sends land in their thread, settle and unsettle archive and unarchive.
- `POST /__fixture/mail` with `{ loseNextAnswerMs }` loses the next send's answer; with `{ refuseNextArchive: "<error>" }` Gmail refuses the next archive or unarchive.
- An agent draft is `comma/drafts:prepareDraft` through `/__fixture/convex` with `chatGuid: "mail:t-venue"`.
- Composer fields are labelled `To`, `Cc`, `Subject` and `Message` inside `getByTestId("email-composer")`.

## Gotchas

- Gmail's own threading cannot be seen here: no mailbox is connected. `convex/comma/gmailLane.test.ts` proves the In-Reply-To, References and threadId the send carries.
- Run on a private port (`IMSG_FIXTURE_PORT=8471`); the config reuses any server on its port.
