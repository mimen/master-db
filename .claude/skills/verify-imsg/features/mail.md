# Mail

Mail is its own workspace (sidebar footer and phone tab). It lists the mailbox's inbox threads under two lenses. People holds a thread whose last message came from someone who resolves to a person and is owed a reply. All inbox holds everything, newsletters and strangers included. Email threads never show in Messages. The reader shows each message as a card: sender, To and Cc, time, and the body. The body is HTML that Convex cleaned, shown in an iframe that runs no scripts and loads nothing remote until **Load images**. The reader's Reply and Reply all open the email composer, and Archive settles the thread; [Mail sending](./mail-send.md) covers both.

## Sub-features

- `mail-lenses`: People shows "Load-in for Saturday" only and a "2 more in All inbox" row; All inbox adds the newsletter and the stranger.
- `mail-reader`: two cards in "Load-in for Saturday"; the second card's iframe has no `<script>`, no tracking pixel and no loaded remote image.
- `mail-images`: **Load images** gives the floor plan a `src`, and the pixel still never loads.
- `mail-phone`: the Mail tab, then the thread, then **Back to Mail**.

## How to get to it (user POV)

Click **Mail** in the sidebar footer, or the envelope tab on a phone, then click Sam Lee's thread.

## Driving it with Playwright (desk fixture)

The drive is `apps/imsg/e2e/fixture/mail.playwright.ts`. CI runs it with every fixture spec.

- The fixture's mailbox (`e2e/fixture/mail.ts`) is always present. It answers `comma/queries:listEmailThreads` and `listMessages`, and its HTML goes through the real cleaner (`convex/comma/emailHtml.ts`).
- Lenses are `getByRole("tab", { name: "People, 1" })` and `"All inbox, 3"`. A thread row is the button named `<sender>, <subject>`.
- Read the body with `page.frameLocator('[data-testid="email-reader"] iframe')`.

## Gotchas

- Run the suite on a private port (`IMSG_FIXTURE_PORT=8471`). The config reuses any server on its port, and another worktree's fixture server serves that worktree's build.
- Phones show the plain text, not the HTML (no WebView yet).
