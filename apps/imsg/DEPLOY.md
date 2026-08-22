# Comma deployment

Comma is the desktop/web product in `apps/imsg`. Its delivery chain is:

```text
Git commit → web and shell artifacts → Mini / laptop → running client → release identity
```

## Surfaces

| Surface | Destination | Identity |
| --- | --- | --- |
| Production web/API | Mini, `127.0.0.1:8377`, exposed at `https://milads-mac-mini.taild31e9a.ts.net:8447` | `/api/deploy/status` |
| Expo Go | Mini Metro server, `exp://milads-mac-mini:8081` | pulled source revision on the Mini |
| Production desktop | `/Users/mimen/Applications/Comma.app` | bundle ID `com.milad.imsg.desktop`, embedded `CommaSourceSHA` |
| Branch preview | Branch-specific Mini port and tailnet URL | branch manifest served at `/__comma/manifest` |
| Branch desktop | `Comma Dev — <branch>` | branch-derived bundle ID, title, icon, URL, and SHA |

A release can be **deployed** before it is **activated**. Web activation happens when the user accepts the Reload banner. Shell activation happens when the laptop has staged the published app and the user accepts Restart.

## Canonical commands

Run from `apps/imsg` unless noted otherwise.

```bash
bun run dev:desktop                 # guarded, branch-identified native development
bun run deploy:branch -- --dry-run  # show a branch deployment without live writes
bun run deploy:branch               # push and deploy the current branch preview
bun run deploy:status               # deployed, staged, installed, activation state, and process identity
bun run deploy:verify               # require the real production web and app surfaces
bun run deploy:activate             # bootstrap the first staged shell from an older installed Comma
bun run deploy:rollback             # exchange Comma.app with the retained previous shell
bun run deploy:cleanup              # inspect expired branch resources
bun run deploy:cleanup -- --apply   # remove expired resources, skipping running apps
```

Production deploys automatically when `main` changes under `apps/imsg/**` or the root lockfile. The Mini self-hosted GitHub runner calls `apps/imsg/scripts/deploy.sh`; humans and CI use the same implementation.

## Production flow

1. Merge the exact change to `main`.
2. The Mini pulls `main`, installs locked dependencies, then runs imsg typecheck, lint, and tests.
3. Web builds into a sibling `.dist-staging-*` directory. If shell inputs changed, the Mini also builds immutable `Comma-<sha>.app.zip` bytes without moving `desktop/releases/current.json`.
4. Only after every required build succeeds, the completed web directory swaps atomically into `client/dist`. One prior asset set remains live for already-open clients; two prior full dist generations are retained as bounded recovery archives.
5. The Mini installs or updates the checked-in `comma:server` and `comma:expo` LaunchAgents, restarts both services, verifies local and tailnet API plus real `/` health, then publishes `web-release.json` and repoints `desktop/releases/current.json`. A failed restart or health check leaves both release pointers unchanged.
6. The laptop stager downloads and verifies size, checksum, ad-hoc signature, bundle ID, architecture, semver, and embedded SHA. It stages beside the canonical app without replacing the running bundle.
7. Comma shows Reload and Restart banners when deployed identity differs from running identity.
8. Restart uses a detached activator. It waits for Comma to exit, swaps atomically, retains `Comma.app.previous` for seven days, relaunches, and rolls back automatically if the new app does not verify.

Production deploy status is visible in the GitHub Actions summary and through:

```bash
curl -s https://milads-mac-mini.taild31e9a.ts.net:8447/api/deploy/status
curl -s https://milads-mac-mini.taild31e9a.ts.net:8447/api/desktop-release
bun run deploy:status
```

`bun run deploy:verify` runs on the laptop with the canonical installed app. It renders the real production `/` in Chromium, verifies the HTML release SHA and hashed entry asset against `/api/deploy/status`, requires immutable asset caching, checks the published and installed shell identities, requires exactly one `/Users/mimen/Applications/Comma.app` process, and writes a screenshot plus JSON proof under `~/Library/Application Support/imsg-deploy/visual-proofs/`. Proofs are bounded to five releases by default. For a visual change, set `COMMA_VERIFY_EXPECT_TEXT` to changed on-screen copy; set `COMMA_VERIFY_EXPECT_VISUAL_CHANGE_FROM_SHA=<prior-sha>` to require the new screenshot to differ from a retained proof.

## Branch previews

`bun run deploy:branch` requires a clean named branch. It derives isolated ports, output paths, process identity, URL, manifest, app name, and bundle ID from the branch/worktree.

- UI-only branches serve their own static export and proxy `/api` and `/events` to the single production server. These previews have full live behavior, including real sends and mutations.
- Branches changing server code run a separate server against a scratch overlay database. They never open production `imsg.db`.
- Native branches may build a separately identified Comma Dev app. They never replace production Comma or another branch app.

Use the browser for shared UI/business behavior. Build and drive Comma Dev when the change touches native packaging, titlebar/menu behavior, permissions, updater logic, deep links, or a WebKit-specific difference.

## Resident processes

Production singletons use `comma:<role>`. Concurrent branch resources add a normalized ref:

```text
comma:server
comma:expo
comma:stager
comma:activator
comma:preview@<ref>
comma:desktop-dev@<ref>
```

The production Mini plists are rendered from `scripts/launchagents/` and installed or updated by `scripts/install-mini-launchagents.sh`; the production deploy runs that installer before its service restarts. To repair them directly on the Mini, run `bash apps/imsg/scripts/install-mini-launchagents.sh --repo "$HOME/Programming/Repos/master-db"` from the canonical checkout. Each update retains the immediately prior definitions under `~/Library/Application Support/imsg-deploy/launchagents/` and restores every changed service if the migration fails. The installer keeps Bun as the final executable and adds only argv identity through `zsh` `exec`; after the first install, smoke-test full-history search because Messages `chat.db` access still depends on the Mini's Full Disk Access grant.

Do not kill processes by executable name alone. Read the full argv identity and branch manifest first.

## Recovery

- **Build fails:** the active dist and both release pointers remain unchanged.
- **Install, restart, health, or pointer verification fails after activation:** the deploy atomically restores the archived web dist and restores the prior web and shell pointers. The pulled checkout remains at the new SHA, so this is a served-web/pointer rollback rather than a source revert; the next serialized deploy retries from the canonical checkout. The workflow summary therefore shows the previous release on a failed run.
- **Web deploy is bad after a successful gate:** rollback is manual by reverting and merging to `main`. Prior web generations are bounded to two under `client/web-releases/`.
- **Interrupted shell publication:** the next shell build removes dead-PID or older-than-30-minute `.tmp.*` publications. Shell retention keeps the current release, its immediate predecessor, and at most one additional release by default.
- **Shell staging fails:** production keeps running; inspect `~/Library/Logs/comma-stager.log`.
- **Shell activation fails:** the activator restores the previous app and records `~/Library/Application Support/Comma/activation.json`.
- **Manual shell rollback:** run `bun run deploy:rollback` while a verified `.previous` bundle exists.
- **Branch collision or residue:** run `bun run deploy:cleanup`, then apply only after inspecting its output.

## Unsafe bypasses

These paths discard the guarantees above:

- raw `tauri dev`, Cargo debug runs, or worktree/release-build apps using the production identity; production-identical runtime is accepted only from `/Users/mimen/Applications/Comma.app`;
- copying a debug `.app` into Applications;
- compiling the production shell on the laptop updater;
- replacing a running `Comma.app` bundle;
- running branch server code against production `imsg.db`;
- rsyncing only `client/dist` and assuming Expo Go source also changed;
- deleting preview ports, processes, or app data without checking their branch identity.
