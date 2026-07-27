/**
 * Builds a single self-contained HTML page from the captures.
 *
 * Self-contained is the requirement, not a preference: the sheet is meant to be
 * published or handed around as one file, so every image is inlined as a data
 * URI rather than referenced from a sibling directory that won't travel with it.
 */
import type { Shot } from "./shots";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function figure(shot: Shot): string {
  const { width, height } = shot.viewport;
  return `
  <figure class="shot ${width >= 768 ? "wide" : "narrow"}" id="${escapeHtml(shot.name)}">
    <figcaption>
      <span class="name">${escapeHtml(shot.name)}</span>
      <span class="meta">${width}×${height} · ${shot.scheme}</span>
      <span class="caption">${escapeHtml(shot.caption)}</span>
    </figcaption>
    <div class="frame">
      <img alt="${escapeHtml(shot.caption)}" width="${width}" height="${height}"
           src="data:image/png;base64,${shot.png.toString("base64")}"/>
    </div>
  </figure>`;
}

export function buildContactSheet(shots: readonly Shot[], generatedAt: Date): string {
  const wide = shots.filter((shot) => shot.viewport.width >= 768);
  const narrow = shots.filter((shot) => shot.viewport.width < 768);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>imsg render — ${generatedAt.toISOString().slice(0, 16).replace("T", " ")}Z</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f6f8; --panel: #ffffff; --ink: #16161a; --muted: #6c6c78;
    --line: #e2e2e8; --accent: #2f6fed;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #101013; --panel: #1a1a1f; --ink: #ececf1; --muted: #9a9aa6; --line: #2a2a33; --accent: #6f9dff; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 28px 80px; background: var(--bg); color: var(--ink);
         font: 15px/1.55 ui-sans-serif, -apple-system, "SF Pro Text", Inter, system-ui, sans-serif; }
  header { max-width: 960px; margin: 0 auto 36px; }
  h1 { font-size: 26px; letter-spacing: -0.02em; margin: 0 0 8px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--muted);
       margin: 46px auto 18px; max-width: 1520px; }
  p { margin: 0 0 10px; color: var(--muted); max-width: 70ch; }
  .fixture { display: inline-block; margin-top: 8px; padding: 8px 12px; border-radius: 8px;
             background: color-mix(in srgb, var(--accent) 12%, transparent);
             color: var(--accent); font-weight: 600; font-size: 13px; }
  .grid { max-width: 1520px; margin: 0 auto; display: grid; gap: 26px; }
  .grid.wide { grid-template-columns: 1fr; }
  .grid.narrow { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  figure { margin: 0; background: var(--panel); border: 1px solid var(--line);
           border-radius: 14px; overflow: hidden; }
  figcaption { padding: 14px 16px; border-bottom: 1px solid var(--line);
               display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline; }
  .name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; color: var(--accent); }
  .meta { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .caption { flex: 1 1 100%; font-size: 13.5px; color: var(--muted); }
  .frame { overflow-x: auto; background: var(--bg); }
  img { display: block; width: 100%; height: auto; max-width: 100%; }
  footer { max-width: 960px; margin: 60px auto 0; padding-top: 20px; border-top: 1px solid var(--line);
           font-size: 13px; color: var(--muted); }
</style>
</head>
<body>
<header>
  <h1>imsg render</h1>
  <p>Headless Playwright captures of the imsg PWA at two fixed viewports — 1440×900 (split pane)
     and 390×844 (list, then thread) — walking all four state lenses: Unread, Unresponded,
     Waiting, Archived.</p>
  <p>Generated ${escapeHtml(generatedAt.toISOString())} · ${shots.length} captures</p>
  <span class="fixture">Fixture data only — every name, number, and message here is invented. No real conversation appears in this render.</span>
</header>

<h2>Desktop · 1440×900 · split pane</h2>
<div class="grid wide">${wide.map(figure).join("\n")}</div>

<h2>Mobile · 390×844 · list, then thread</h2>
<div class="grid narrow">${narrow.map(figure).join("\n")}</div>

<footer>Regenerate with <code>bun run render</code> in <code>apps/imsg</code>.</footer>
</body>
</html>
`;
}
