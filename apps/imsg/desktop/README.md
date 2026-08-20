# imsg desktop

Thin Tauri v2 shell. The window loads the Mini's tailnet URL; this package
does not bundle `client/dist/`. Overlay title bar, native menu (⌘N / ⌘W / ⌘F / ⌘K).

```bash
cd apps/imsg/desktop
bun install
bun run tauri dev
```

Ad-hoc local build: `bunx tauri build`. No Apple Developer account required.
