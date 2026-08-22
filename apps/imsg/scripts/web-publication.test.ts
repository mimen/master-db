import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const activator = join(import.meta.dir, "web-activate.py");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("atomic web release activation", () => {
  test("swaps only a completed dist, carries one prior asset set, and bounds archives", async () => {
    const root = mkdtempSync(join(tmpdir(), "comma-web-activation-"));
    roots.push(root);
    const active = join(root, "dist");
    const staging = join(root, ".dist-staging-new");
    const archives = join(root, "web-releases");
    const oldAsset = "_expo/static/js/web/entry-old.js";
    const newAsset = "_expo/static/js/web/entry-new.js";

    mkdirSync(join(active, "_expo/static/js/web"), { recursive: true });
    writeFileSync(join(active, "index.html"), "old");
    writeFileSync(join(active, oldAsset), "old bundle");
    writeFileSync(join(active, ".comma-assets"), `${oldAsset}\n`);

    mkdirSync(join(staging, "_expo/static/js/web"), { recursive: true });
    writeFileSync(join(staging, "index.html"), "new");
    writeFileSync(join(staging, newAsset), "new bundle");
    writeFileSync(join(staging, ".comma-assets"), `${newAsset}\n`);

    for (const sha of ["1".repeat(40), "2".repeat(40), "3".repeat(40)]) {
      mkdirSync(join(archives, sha), { recursive: true });
      writeFileSync(join(archives, sha, "index.html"), sha);
    }

    const result = Bun.spawnSync({
      cmd: ["/usr/bin/python3", activator, "activate", staging, active, archives, "a".repeat(40), "2"],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(await Bun.file(join(active, "index.html")).text()).toBe("new");
    expect(await Bun.file(join(active, newAsset)).text()).toBe("new bundle");
    expect(await Bun.file(join(active, oldAsset)).text()).toBe("old bundle");
    expect(readdirSync(archives).length).toBe(2);

    const archived = result.stdout.toString().trim();
    const rollback = Bun.spawnSync({
      cmd: ["/usr/bin/python3", activator, "rollback", active, archived],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(rollback.exitCode, rollback.stderr.toString()).toBe(0);
    expect(await Bun.file(join(active, "index.html")).text()).toBe("old");
  });

  test("rejects incomplete staging without disturbing the active dist", async () => {
    const root = mkdtempSync(join(tmpdir(), "comma-web-incomplete-"));
    roots.push(root);
    const active = join(root, "dist");
    const staging = join(root, ".dist-staging-bad");
    mkdirSync(active);
    mkdirSync(staging);
    writeFileSync(join(active, "index.html"), "still active");

    const result = Bun.spawnSync({
      cmd: ["/usr/bin/python3", activator, "activate", staging, active, join(root, "archives"), "b".repeat(40), "2"],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("staged release is incomplete");
    expect(await Bun.file(join(active, "index.html")).text()).toBe("still active");
  });

  test("self-unwinds when archival fails after the atomic swap", async () => {
    const root = mkdtempSync(join(tmpdir(), "comma-web-unwind-"));
    roots.push(root);
    const active = join(root, "dist");
    const staging = join(root, ".dist-staging-new");
    for (const [directory, value] of [[active, "old"], [staging, "new"]] as const) {
      mkdirSync(join(directory, "_expo/static/js/web"), { recursive: true });
      writeFileSync(join(directory, "index.html"), value);
      writeFileSync(join(directory, ".comma-assets"), "_expo/static/js/web/entry.js\n");
      writeFileSync(join(directory, "_expo/static/js/web/entry.js"), value);
    }
    const probe = `
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("web_activate", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.prune_archives = lambda *_: (_ for _ in ()).throw(RuntimeError("forced prune failure"))
try:
    module.activate(pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]), pathlib.Path(sys.argv[4]), "a" * 40, 2)
except RuntimeError:
    pass
else:
    raise SystemExit("activation unexpectedly succeeded")
`;
    const result = Bun.spawnSync({
      cmd: ["/usr/bin/python3", "-c", probe, activator, staging, active, join(root, "archives")],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(await Bun.file(join(active, "index.html")).text()).toBe("old");
  });
});
