# imsg — agent operating notes

Universal Messages client (Expo Router; **iOS via Expo Go** + **web**) + Bun/Hono server
fronting the Mac Mini's BlueBubbles. Read `CONTEXT.md` for the domain model/vocabulary.

## Repo layout (important)

- Lives in the **master-db monorepo** at `apps/imsg`. `~/Programming/Repos/imsg` is a
  **symlink**: on the laptop → `convex-db/.worktrees/main/apps/imsg`; on the Mini →
  `master-db/apps/imsg`. The pre-migration standalone repo is parked at
  `~/Programming/Repos/imsg.pre-migration-backup` on both machines.
- Client: `client/` (Expo, SDK **54** — pinned to the Expo Go App Store ceiling; do not
  bump without an EAS build). Server: `server/`. Shared types/logic: `shared/`
  (imported as `@shared/*`; the client keeps a synced copy at `client/src/lib/types.ts`).

## The Mini serves TWO things — and they read from DIFFERENT sources

1. **Web / dock app** (`com.milad.imsg`, port 8377): serves the built `client/dist/`.
   Updated by shipping a fresh `dist/`.
2. **Native / Expo Go** (`com.milad.imsg-expo`, port 8081): the Expo dev server bundles
   from the **`client/src` source tree on the Mini**. Updated only by **`git pull` on the
   Mini** — an rsync of `dist/` does NOT touch it.

⚠️ **The #1 deploy footgun:** rsyncing `dist/` updates the web app but NOT Expo Go. If a
fix "isn't landing on the phone," the Mini's source is stale — you forgot the `git pull`.

## Deploy (do the whole thing every time)

```bash
# 1. Verify locally
cd ~/Programming/Repos/imsg && bun test        # 75 tests
cd client && bunx tsc --noEmit                  # client typecheck
cd .. && bunx tsc -b tsconfig.server.json       # server typecheck
cd client && bun run build:web                  # builds dist/ + injects PWA/zoom-lock head

# 2. Commit + push to origin/main (rebase — other sessions share master-db)
cd ~/Programming/Repos/imsg && git add -A && git commit -m "…"
cd ~/Programming/Repos/convex-db/.worktrees/main && git pull --rebase origin main && git push origin main

# 3. Ship BOTH surfaces to the Mini
rsync -a --delete ~/Programming/Repos/imsg/client/dist/ macmini:Programming/Repos/master-db/apps/imsg/client/dist/
ssh macmini 'export PATH="$HOME/.bun/bin:$PATH" && cd ~/Programming/Repos/master-db \
  && git checkout -- apps/imsg/client/bun.lock apps/imsg/bun.lock 2>/dev/null; git pull \
  && cd apps/imsg/client && bun install \
  && cd ~/Programming/Repos/master-db \
  && launchctl kickstart -k gui/$(id -u)/com.milad.imsg \
  && launchctl kickstart -k gui/$(id -u)/com.milad.imsg-expo'
```

Then **shake → Reload in Expo Go** (native) / hard-refresh or re-add the PWA (web).

## Verify after deploy

- API: `curl -s http://Milads-Mac-mini:8377/api/health` → `{"ok":true,"privateApi":true}`
- Expo bundle: `curl -s -H "expo-platform: ios" http://Milads-Mac-mini:8081` → JSON with `runtimeVersion: exposdk:54.0.0`
- URLs: `http://milads-mac-mini:8377` (web), `https://milads-mac-mini.taild31e9a.ts.net:8445`
  (tailnet HTTPS — needed for PWA install + dock badge), `exp://milads-mac-mini:8081` (Expo Go).

## Gotchas

- **`.env` is NOT in the checkout** (gitignored). Local server runs need
  `BB_URL/BB_PASSWORD/PORT/DB_PATH`; full-history search also needs
  `CHATDB_PATH=$HOME/Library/Messages/chat.db`. The Mini's `apps/imsg/.env` has them.
- **Overlay DB (`imsg.db`) and `.cache/avatars/`** hold pins/archives/dismissals and
  contact photos — carry them on any checkout move; never commit them.
- Contact avatars: run `bun scripts/export-avatars.ts` **on the Mini** (needs FDA via ssh)
  after contact-photo changes; BlueBubbles itself returns no avatars.
- master-db `bun.lock` churns across sessions — `git checkout -- **/bun.lock` before pull.
- **To iterate, use Expo Go** (always-live source). The Safari home-screen PWA caches
  aggressively and will show half-applied fixes; re-add it to clear the service worker.
