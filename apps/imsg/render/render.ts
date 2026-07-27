#!/usr/bin/env bun
/**
 * `bun run render` — screenshot the imsg PWA against invented data.
 *
 * Boots a throwaway server on the render fixture, drives it headlessly through
 * both layouts and all four state lenses, and writes PNGs plus a self-contained
 * contact sheet. It is deliberately incapable of touching real history: the
 * BlueBubbles seam is swapped for the in-memory fake, and the server it starts
 * is a different port and a different database from the one that runs daily.
 *
 * Flags:
 *   --out <dir>   where to write (default: render/out)
 *   --port <n>    fixture server port (default: 8399)
 *   --build       force a client re-export even if client/dist exists
 *   --keep-open   leave the fixture server running after the captures
 */
import { chromium } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findChromiumExecutable } from "./chromium";
import { buildContactSheet } from "./contact-sheet";
import { APP_ROOT, ensureClientBuild, startFixtureServer } from "./server";
import { captureAll } from "./shots";

interface Options {
  readonly outDir: string;
  readonly port: number;
  readonly build: boolean;
  readonly keepOpen: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const flag = (name: string): string | null => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? (argv[index + 1] ?? null) : null;
  };
  return {
    outDir: flag("out") ?? join(APP_ROOT, "render", "out"),
    port: Number(flag("port") ?? 8399),
    build: argv.includes("--build"),
    keepOpen: argv.includes("--keep-open"),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const started = Date.now();

  const built = await ensureClientBuild(options.build);
  console.log(built ? "Client exported" : "Client bundle reused (--build to re-export)");

  const server = await startFixtureServer(options.port);
  console.log(`Fixture server up on ${server.baseUrl} (log: ${server.logPath})`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: findChromiumExecutable(),
  });

  try {
    const shots = await captureAll({ browser, baseUrl: server.baseUrl });
    if (shots.length === 0) throw new Error("capture produced no shots");

    rmSync(options.outDir, { recursive: true, force: true });
    mkdirSync(options.outDir, { recursive: true });
    for (const shot of shots) {
      writeFileSync(join(options.outDir, `${shot.name}.png`), shot.png);
    }
    const sheetPath = join(options.outDir, "index.html");
    writeFileSync(sheetPath, buildContactSheet(shots, new Date()));

    console.log(`\n${shots.length} captures in ${((Date.now() - started) / 1000).toFixed(0)}s`);
    for (const shot of shots) {
      console.log(`  ${shot.name}.png  ${(shot.png.byteLength / 1024).toFixed(0)}KB`);
    }
    console.log(`\nContact sheet: ${sheetPath}`);
  } finally {
    await browser.close();
    if (options.keepOpen) {
      console.log(`Fixture server still running on ${server.baseUrl} — Ctrl-C to stop.`);
      await new Promise(() => undefined);
    }
    await server.stop();
  }
}

await main();
