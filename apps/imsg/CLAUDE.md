# imsg — agent operating notes

Universal Messages client (Expo Router; **iOS via Expo Go** + **web**) + Bun/Hono server
fronting the Mac Mini's BlueBubbles. Read `CONTEXT.md` for the domain model/vocabulary.

## Repo layout (important)

- Lives in the **master-db monorepo** at `apps/imsg`. `~/Programming/Repos/imsg` is a
  **symlink**: on the laptop → `convex-db/apps/imsg` (the primary checkout); on the Mini →
  `master-db/apps/imsg`. The pre-migration standalone repo is parked at
  `~/Programming/Repos/imsg.pre-migration-backup` on both machines.
- **The server runs ONLY on the Mini.** Every client uses
  `https://milads-mac-mini.taild31e9a.ts.net:8447` (web/PWA/desktop) or Expo Go; there is no
  resident laptop server, so all production overlay state lives in one place. Branches
  changing server code use the deployment command's scratch DB mode.
- Client: `client/` (Expo, SDK **54** — pinned to the Expo Go App Store ceiling; do not
  bump without an EAS build). Server: `server/`. Shared types/logic: `shared/`
  (imported as `@shared/*`; the client keeps a synced copy at `client/src/lib/types.ts`).
- Desktop shell: `desktop/` (Tauri v2). Thin remote window — loads the Mini tailnet
  URL with native AppKit chrome and menu. `bun run dev:desktop` is the only supported
  development launcher; it derives a branch-specific Comma Dev identity.

## The Mini serves TWO things — and they read from DIFFERENT sources

1. **Web / dock app** (`com.milad.imsg`, loopback port 8377): serves the built `client/dist/`.
   Tailscale Serve exposes it at HTTPS port 8447. Updated by shipping a fresh `dist/`.
2. **Native / Expo Go** (`com.milad.imsg-expo`, port 8081): the Expo dev server bundles
   from the **`client/src` source tree on the Mini**. Updated only by **`git pull` on the
   Mini** — an rsync of `dist/` does NOT touch it.

⚠️ **The #1 deploy footgun:** rsyncing `dist/` updates the web app but NOT Expo Go. If a
fix "isn't landing on the phone," the Mini's source is stale — you forgot the `git pull`.

## Deployment

Read [`DEPLOY.md`](DEPLOY.md) before changing or operating delivery. The canonical paths are:

```bash
bun run dev:desktop
bun run deploy:branch -- --dry-run
bun run deploy:branch
bun run deploy:status
bun run deploy:activate  # bootstrap the first staged shell from an older installed Comma
bun run deploy:verify
bun run deploy:cleanup
```

A merge to `main` automatically deploys production through the Mini runner. The gate runs
typecheck, lint, and tests; builds web in a sibling directory; builds immutable shell bytes;
atomically activates web; restarts and health-checks the services; then publishes release
pointers. The checked-in LaunchAgent installer gives the Mini processes `comma:server` and
`comma:expo` argv identities. Do not rsync `dist`, run raw `tauri dev`, copy worktree apps
into Applications, or manually replace a running production bundle. Production-identical
shell runtime is restricted to `/Users/mimen/Applications/Comma.app`; the Mini may build
that artifact but never launches it. Web and shell updates activate through the in-app Reload
and Restart banners.

## Gotchas

- **`.env` is NOT in the checkout** (gitignored). Local server runs need
  `BB_URL/BB_PASSWORD/HOST/PORT/DB_PATH`; keep `HOST=127.0.0.1`. Full-history search also needs
  `CHATDB_PATH=$HOME/Library/Messages/chat.db`. The Mini's `apps/imsg/.env` has them.
- **Overlay DB (`imsg.db`) and `.cache/avatars/`** hold pins/archives/dismissals and
  contact photos — carry them on any checkout move; never commit them.
- Contact avatars: run `bun scripts/export-avatars.ts` **on the Mini** (needs FDA via ssh)
  after contact-photo changes; BlueBubbles itself returns no avatars.
- master-db `bun.lock` churns across sessions — `git checkout -- **/bun.lock` before pull.
- Test shared UI/business behavior in the browser fixture. Use Expo Go for iOS seams and
  `bun run dev:desktop` for native shell seams. Production clients expose explicit update
  banners instead of relying on cache-clearing rituals.
