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
| Branch preview | Branch-specific Mini port and tailnet URL | branch manifest served at `/api/branch-manifest` |
| Branch desktop | `Comma Dev — <branch>` | branch-derived bundle ID, title, icon, URL, and SHA |

A release can be **deployed** before it is **activated**. Web activation happens when the user accepts the Reload banner. Shell activation happens when the laptop has staged the published app and the user accepts Restart.

## Canonical commands

Run from `apps/imsg` unless noted otherwise.

```bash
bun run dev:desktop                 # guarded, branch-identified native development
bun run deploy:branch -- --dry-run  # show a branch deployment without live writes
bun run deploy:branch               # push and deploy the current branch preview
bun run deploy:status               # deployed, staged, installed, and process identity
bun run deploy:verify               # require the real production web and app surfaces
bun run deploy:rollback             # exchange Comma.app with the retained previous shell
bun run deploy:cleanup              # inspect expired branch resources
bun run deploy:cleanup -- --apply   # remove expired resources, skipping running apps
```

Production deploys automatically when `main` changes under `apps/imsg/**` or the root lockfile. The Mini self-hosted GitHub runner calls `apps/imsg/scripts/deploy.sh`; humans and CI use the same implementation.

## Production flow

1. Merge the exact change to `main`.
2. The Mini pulls `main`, installs locked dependencies, runs imsg typecheck/tests, and builds the web export with the production commit embedded.
3. The deploy writes `web-release.json`, builds a shell release only when shell inputs changed, restarts the Mini services, and verifies local and tailnet health.
4. The Mini publishes immutable `Comma-<sha>.app.zip` bytes and `desktop/releases/current.json`.
5. The laptop stager downloads and verifies size, checksum, ad-hoc signature, bundle ID, architecture, semver, and embedded SHA. It stages beside the canonical app without replacing the running bundle.
6. Comma shows Reload and Restart banners when deployed identity differs from running identity.
7. Restart uses a detached activator. It waits for Comma to exit, swaps atomically, retains `Comma.app.previous` for seven days, relaunches, and rolls back automatically if the new app does not verify.

Production deploy status is visible in the GitHub Actions summary and through:

```bash
curl -s https://milads-mac-mini.taild31e9a.ts.net:8447/api/deploy/status
curl -s https://milads-mac-mini.taild31e9a.ts.net:8447/api/desktop-release
bun run deploy:status
```

## Branch previews

`bun run deploy:branch` requires a clean named branch. It derives isolated ports, output paths, process identity, URL, manifest, app name, and bundle ID from the branch/worktree.

- UI-only branches serve their own static export and proxy `/api` and `/events` to the single production server. These previews have full live behavior, including real sends and mutations.
- Branches changing server code run a separate server against a scratch overlay database. They never open production `imsg.db`.
- Native branches may build a separately identified Comma Dev app. They never replace production Comma or another branch app.

Use the browser for shared UI/business behavior. Build and drive Comma Dev when the change touches native packaging, titlebar/menu behavior, permissions, updater logic, deep links, or a WebKit-specific difference.

## Resident processes

Production singletons use `comma:<role>`. Concurrent branch resources add a normalized ref:

```text
comma:stager
comma:activator
comma:preview@<ref>
comma:desktop-dev@<ref>
```

Do not kill processes by executable name alone. Read the full argv identity and branch manifest first.

## Recovery

- **Web deploy is bad:** the workflow reports the failed release; web rollback is manual by reverting and merging to `main`.
- **Shell staging fails:** production keeps running; inspect `~/Library/Logs/comma-stager.log`.
- **Shell activation fails:** the activator restores the previous app and records `~/Library/Application Support/Comma/activation.json`.
- **Manual shell rollback:** run `bun run deploy:rollback` while a verified `.previous` bundle exists.
- **Branch collision or residue:** run `bun run deploy:cleanup`, then apply only after inspecting its output.

## Unsafe bypasses

These paths discard the guarantees above:

- raw `tauri dev`, Cargo debug runs, or worktree-built apps using the production identity;
- copying a debug `.app` into Applications;
- compiling the production shell on the laptop updater;
- replacing a running `Comma.app` bundle;
- running branch server code against production `imsg.db`;
- rsyncing only `client/dist` and assuming Expo Go source also changed;
- deleting preview ports, processes, or app data without checking their branch identity.
