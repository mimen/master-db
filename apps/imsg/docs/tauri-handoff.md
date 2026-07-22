# Handoff: wrap imsg in a native macOS shell (Tauri)

Goal: turn the desktop web app into a **real Mac app** — a dock app with a
native menu bar that owns the keyboard shortcuts the browser reserves (⌘N, ⌘W,
⌘F, ⌘, …). The web UI is reused as-is; nothing in `client/` gets rewritten.

## Why this doc exists

In the Chrome-installed PWA, the browser intercepts ⌘N / ⌘T / ⌘W / ⌘L / ⌘Q at
the window-manager level **before** the page's `keydown` handler runs, so the
app can never make ⌘N = "new message." The only fix is to stop being a web page
in a browser and become a native window that owns its own menu.

## Decision context (live pulse, 2026-07)

For an Expo/react-native-web codebase, the community meta is to **wrap the web
build**, not go react-native-macos (that forks the UI; `expo-*` modules don't
run on it). Two wrapper choices:

- **Electron** — the *consensus* for Expo teams. Chromium everywhere → the UI
  renders in the same engine you built in, no parity surprises. Cost: ~100MB+
  binary, more RAM. Expo's own Orbit menu-bar app is RN + Electron.
- **Tauri v2** — the lean runner-up. Tiny binary (system WebView), Rust core.
  **The #1 risk: on macOS it renders in WKWebView (Safari/WebKit), not
  Chromium** — "the pain island." You test in a different engine than the
  browser you developed against.
- **ToDesktop** — an Electron *ops* layer (signing, auto-update, web→desktop
  builder). Not an Expo runtime; a productization option *after* choosing
  Electron.

Milad chose **Tauri**. Honor that, but **Step 0 is a WKWebView spike** — if the
glass blur / gradients / expo-image look wrong in WKWebView and can't be fixed
cheaply, fall back to Electron (or ToDesktop for turnkey signing+updates). Don't
scaffold the whole thing before the spike passes.

## Current state you're building on

- Web app is deployed and served from the Mac Mini:
  - `https://milads-mac-mini.taild31e9a.ts.net:8445` (tailnet HTTPS — use this)
  - `http://milads-mac-mini:8377` (LAN HTTP)
- The API + BlueBubbles run **on the Mini**, same origin as the served web app.
- **Keyboard layer already built** in `client/src/app/(tabs)/index.tsx` (the
  `onKey` handler). It's **⌘-based** (the composer is almost always focused, so
  single-key shortcuts are the wrong model). Working in the browser today:
  `⌘K` search · `⌘↑`/`⌘↓` nav · `⌘E` archive · `⌘⇧U` read/unread · `⌘I` details ·
  `⌘/` help · `Esc` close. `⌘N` (new) and `⌘F` (find) are wired but the browser
  reserves/intercepts them — **the Tauri native menu drives ⌘N, ⌘F, ⌘W** etc.

## Recommended architecture: thin remote shell

Simplest and always-current: the Tauri window **loads the deployed tailnet
URL** rather than bundling `dist/`. No rebuild/redeploy of the desktop app when
the web app changes — it just loads the latest. The API is same-origin, so no
CORS work.

```
Tauri window → loads https://milads-mac-mini.taild31e9a.ts.net:8445
Native menu (Rust) → on ⌘N/⌘F/⌘W → window.emit("imsg-shortcut", "<name>")
Web app → listens for "imsg-shortcut" → runs the same action as the keydown
```

(If you'd rather ship a self-contained app that works off-tailnet, bundle
`client/dist/` and point `BASE_URL` — `client/src/lib/config.ts` — at the Mini's
tailnet API. That needs the Mini reachable and CORS allowing the `tauri://`
origin. The remote-shell approach avoids all of that; prefer it unless you
specifically need offline-of-tailnet.)

## Steps

### 0. WKWebView spike (gate — do this first)
- `npm create tauri-app@latest` (vanilla), set the window to load the tailnet
  URL, `cargo tauri dev`.
- Verify in the WKWebView window: frosted top bar (`backdrop-filter`), avatar
  gradients (`expo-linear-gradient`/CSS), rounded 3D panels + shadows,
  FlashList scroll, the synthetic scrollbar, images.
- `backdrop-filter` needs the `-webkit-` prefix in WebKit — the app already
  emits both `backdropFilter` and `WebkitBackdropFilter`, so it should hold, but
  confirm visually. Also check TLS: the tailnet cert must be trusted by the
  system (it is a real Tailscale cert, so fine).
- **Gate:** if it renders clean → continue with Tauri. If WKWebView fights the
  design → switch the shell to Electron / ToDesktop (same menu-bridge design
  below still applies; Electron uses `Menu`/`accelerator` + `webContents.send`).

### 1. Scaffold
- Tauri v2 project (its own dir, e.g. `apps/imsg-desktop/` or a sibling repo).
- Window config: title "Messages", min size ~900×600, remember size/position,
  hidden-title-bar optional for a cleaner look.
- Point the window at the tailnet URL.

### 2. Native menu + accelerators (Rust)
- Build the app menu with items carrying accelerators:
  `CmdOrCtrl+N` (New Message), `CmdOrCtrl+F` (Find in Conversation),
  `CmdOrCtrl+K` (Search), `CmdOrCtrl+W` (Close Panel / then window),
  `CmdOrCtrl+,` (later: settings). Keep the standard Edit menu (Copy/Paste/
  Select-All) so text editing works.
- On each menu event: `window.emit("imsg-shortcut", "<name>")`.

### 3. Frontend bridge (small `client/` change)
- **Refactor:** extract the actions currently inline in the `onKey` switch into
  named functions — e.g. `runShortcut(name: "new-message" | "search" | "find" |
  "close" | "archive" | "unread" | "details" | "next" | "prev")`. Both the
  keydown handler and the Tauri listener then call `runShortcut`.
- Add a listener that only activates under Tauri (`"__TAURI__" in window`):
  `listen("imsg-shortcut", (e) => runShortcut(e.payload))`. Import from
  `@tauri-apps/api/event`. Guard it so the web/PWA build is unaffected.
- Net effect: ⌘N (and any reserved combo) fires the native menu → emits →
  `runShortcut("new-message")` → same code path as `C` does today.

### 4. Polish
- App icon (reuse `client/assets` / the PWA icon), dock name "Messages".
- Unread dock badge: the web app already computes unread; expose it to the
  shell via `window.emit`/Tauri command → `app.set_badge_label` (macOS).
- Optional: single-instance, deep links, tray.

### 5. Distribution (personal use)
- For your own Mac: `cargo tauri build`, ad-hoc sign, run locally. No Apple
  Developer account needed for personal/local use.
- For sharing/auto-update later: Developer ID signing + notarization, or move to
  ToDesktop/Electron which handle that turnkey.

## Gotchas checklist
- **WKWebView parity** (the big one) — Step 0 gate.
- Reaching the Mini: prefer loading the tailnet URL (same-origin API). Bundled
  `dist/` needs `BASE_URL` repointed + CORS for the `tauri://` origin.
- The PWA/zoom-lock `<head>` injected by `client/scripts/post-export.ts` is
  harmless in a shell; the thin remote-shell approach loads the served page so
  it's already there.
- Keep the standard Edit menu or Copy/Paste/Select-All break in the native
  window.
- Don't bump the Expo SDK for this — the shell is independent of the RN app.

## Definition of done
- Dock app opens the imsg UI in a native window.
- ⌘N opens new message, ⌘F opens in-thread find, ⌘W closes the pane/window,
  ⌘K search — all via the native menu, no browser interception.
- All existing single-key shortcuts still work.
- WKWebView renders the design faithfully (or the shell was switched to Electron
  with the same bridge).
