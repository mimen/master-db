import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const scriptsDir = import.meta.dir;
const releaseNeeded = join(scriptsDir, "desktop-release-needed.sh");
const releaseBuilder = join(scriptsDir, "desktop-build-release.sh");
const stager = join(scriptsDir, "desktop-autoupdate.sh");
const activator = join(scriptsDir, "desktop-activate.sh");
const bootstrapActivator = join(scriptsDir, "desktop-activate-bootstrap.sh");
const rollback = join(scriptsDir, "desktop-rollback.sh");
const deployStatus = join(scriptsDir, "deploy-status.sh");
const appVerifier = join(scriptsDir, "desktop-app-verify.sh");

interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(command: string[], cwd?: string, env?: Record<string, string>): CommandResult {
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    status: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function git(root: string, ...args: string[]): string {
  const result = run(["git", ...args], root);
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function makeApp(path: string, sourceSha: string): void {
  mkdirSync(join(path, "Contents/MacOS"), { recursive: true });
  writeFileSync(
    join(path, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.milad.imsg.desktop</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleExecutable</key><string>Comma</string>
<key>CommaSourceSHA</key><string>${sourceSha}</string>
</dict></plist>`,
  );
  writeFileSync(join(path, "Contents/MacOS/Comma"), `binary-source-sha:${sourceSha}`);
}

function sourceSha(path: string): string {
  return run(["plutil", "-extract", "CommaSourceSHA", "raw", "-o", "-", join(path, "Contents/Info.plist")]).stdout.trim();
}

function makeFakeTools(root: string): string {
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "codesign"), "#!/bin/bash\nif [ \"$1\" = \"-dvv\" ]; then echo 'Signature=adhoc' >&2; fi\nexit 0\n");
  writeFileSync(join(bin, "lipo"), "#!/bin/bash\necho arm64\n");
  writeFileSync(join(bin, "open"), "#!/bin/bash\nexit 0\n");
  writeFileSync(join(bin, "osascript"), "#!/bin/bash\nexit 0\n");
  writeFileSync(join(bin, "notify"), "#!/bin/bash\nprintf '%s | %s\\n' \"$1\" \"$2\" >>\"$COMMA_NOTIFICATION_LOG\"\n");
  writeFileSync(join(bin, "uname"), "#!/bin/bash\necho arm64\n");
  writeFileSync(join(bin, "process-running"), "#!/bin/bash\necho 4242\nexit 0\n");
  writeFileSync(join(bin, "process-missing"), "#!/bin/bash\nexit 1\n");
  for (const name of ["codesign", "lipo", "open", "osascript", "notify", "uname", "process-running", "process-missing"]) {
    chmodSync(join(bin, name), 0o755);
  }
  return bin;
}

const roots: string[] = [];
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "comma-deployment-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("desktop release change detection", () => {
  test("compares against the recorded successful deploy rather than reflog history", () => {
    const root = scratch();
    git(root, "init", "-b", "main");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Test");
    mkdirSync(join(root, "apps/imsg/desktop"), { recursive: true });
    mkdirSync(join(root, "apps/imsg/server"), { recursive: true });
    mkdirSync(join(root, "apps/imsg/scripts"), { recursive: true });
    writeFileSync(join(root, "apps/imsg/desktop/input.txt"), "one");
    writeFileSync(join(root, "apps/imsg/desktop/.gitignore"), "releases/\n");
    writeFileSync(join(root, "apps/imsg/server/app.ts"), "one");
    writeFileSync(join(root, "apps/imsg/scripts/desktop-activate.sh"), "one");
    writeFileSync(join(root, "apps/imsg/scripts/desktop-build-release.sh"), "one");
    git(root, "add", ".");
    git(root, "commit", "-m", "initial");
    const deployed = git(root, "rev-parse", "HEAD");
    const releaseDir = join(root, "apps/imsg/desktop/releases");
    const artifactDir = join(releaseDir, deployed);
    const artifact = join(artifactDir, `Comma-${deployed}.app.zip`);
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(artifact, "artifact");
    writeFileSync(join(releaseDir, "current.json"), JSON.stringify({
      sourceSha: deployed,
      sha256: run(["shasum", "-a", "256", artifact]).stdout.split(" ")[0],
      size: readFileSync(artifact).byteLength,
      builtAt: "2026-08-22T00:00:00Z",
      semver: "0.1.0",
      bundleId: "com.milad.imsg.desktop",
      artifactUrl: `https://example.test/Comma-${deployed}.app.zip`,
    }));

    expect(run([releaseNeeded, root, "", deployed]).status).toBe(0);
    expect(run([releaseNeeded, root, deployed, deployed]).status).toBe(1);

    writeFileSync(join(root, "apps/imsg/server/app.ts"), "two");
    git(root, "add", ".");
    git(root, "commit", "-m", "server only");
    const serverOnly = git(root, "rev-parse", "HEAD");
    expect(run([releaseNeeded, root, deployed, serverOnly]).status).toBe(1);

    writeFileSync(join(root, "apps/imsg/desktop/input.txt"), "two");
    git(root, "add", ".");
    git(root, "commit", "-m", "desktop change");
    const desktopChange = git(root, "rev-parse", "HEAD");
    expect(run([releaseNeeded, root, deployed, desktopChange]).status).toBe(0);
    expect(run([releaseNeeded, root, "f".repeat(40), desktopChange]).status).toBe(0);

    writeFileSync(join(releaseDir, "current.json"), "{");
    expect(run([releaseNeeded, root, desktopChange, desktopChange]).status).toBe(0);
  });
});

describe("desktop release publication", () => {
  test("builds immutable bytes without publishing current, then publishes only on command", async () => {
    const root = scratch();
    const bin = makeFakeTools(root);
    const releaseSha = "a".repeat(40);
    const app = join(root, "Comma.app");
    const releases = join(root, "releases");
    const env = {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      COMMA_RELEASE_DIR: releases,
      COMMA_ARTIFACT_BASE_URL: "https://example.test/releases",
    };
    makeApp(app, releaseSha);

    const result = run([releaseBuilder, "--build", releaseSha, app], undefined, env);
    expect(result.status, result.stderr).toBe(0);
    expect(await Bun.file(join(releases, "current.json")).exists()).toBe(false);

    const manifest = JSON.parse(readFileSync(join(releases, releaseSha, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      sourceSha: releaseSha,
      semver: "0.1.0",
      bundleId: "com.milad.imsg.desktop",
      artifactUrl: `https://example.test/releases/Comma-${releaseSha}.app.zip`,
    });
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.size).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(manifest.builtAt))).toBe(false);

    const publish = run([releaseBuilder, "--publish-current", releaseSha], undefined, env);
    expect(publish.status, publish.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(releases, "current.json"), "utf8"))).toMatchObject({ sourceSha: releaseSha });

    const newerSha = "b".repeat(40);
    makeApp(app, newerSha);
    expect(run([releaseBuilder, "--build", newerSha, app], undefined, env).status).toBe(0);
    expect(JSON.parse(readFileSync(join(releases, "current.json"), "utf8"))).toMatchObject({ sourceSha: releaseSha });

    const retry = run([releaseBuilder, "--build", releaseSha, app], undefined, env);
    expect(retry.status, retry.stderr).toBe(0);
    expect(retry.stdout).toContain("already built");
    expect(JSON.parse(readFileSync(join(releases, "current.json"), "utf8"))).toMatchObject({ sourceSha: releaseSha });
  });

  test("rejects a prebuilt bundle whose compiled SHA differs from publication SHA", () => {
    const root = scratch();
    const bin = makeFakeTools(root);
    const compiledSha = "c".repeat(40);
    const publishedSha = "d".repeat(40);
    const app = join(root, "Comma.app");
    makeApp(app, compiledSha);

    const result = run([releaseBuilder, "--build", publishedSha, app], undefined, {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      COMMA_RELEASE_DIR: join(root, "releases"),
      COMMA_ARTIFACT_BASE_URL: "https://example.test/releases",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not embed source SHA");
  });

  test("sweeps cancelled temp publications and retains a bounded current history", () => {
    const root = scratch();
    const bin = makeFakeTools(root);
    const app = join(root, "Comma.app");
    const releases = join(root, "releases");
    const env = {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      COMMA_RELEASE_DIR: releases,
      COMMA_ARTIFACT_BASE_URL: "https://example.test/releases",
      COMMA_RELEASE_RETENTION: "2",
    };
    mkdirSync(join(releases, ".cancelled.tmp.999999"), { recursive: true });
    writeFileSync(join(releases, ".current.json.tmp.999998"), "cancelled");

    for (const digit of ["1", "2", "3"]) {
      const sha = digit.repeat(40);
      makeApp(app, sha);
      const build = run([releaseBuilder, "--build", sha, app], undefined, env);
      expect(build.status, build.stderr).toBe(0);
      const publish = run([releaseBuilder, "--publish-current", sha], undefined, env);
      expect(publish.status, publish.stderr).toBe(0);
    }

    const releaseDirectories = readdirSync(releases).filter((name) => /^[0-9a-f]{40}$/.test(name));
    expect(releaseDirectories.sort()).toEqual(["2".repeat(40), "3".repeat(40)]);
    expect(readdirSync(releases)).not.toContain(".cancelled.tmp.999999");
    expect(readdirSync(releases)).not.toContain(".current.json.tmp.999998");
  });
});

describe("desktop shell staging", () => {
  test("downloads and verifies a Mini artifact while leaving the running app untouched", async () => {
    const root = scratch();
    const bin = makeFakeTools(root);
    const currentSha = "1".repeat(40);
    const releaseSha = "2".repeat(40);
    const app = join(root, "Comma.app");
    const sourceApp = join(root, "artifact/Comma.app");
    makeApp(app, currentSha);
    makeApp(sourceApp, releaseSha);
    const archive = join(root, `Comma-${releaseSha}.app.zip`);
    expect(run(["ditto", "-c", "-k", "--keepParent", sourceApp, archive]).status).toBe(0);
    const checksum = run(["shasum", "-a", "256", archive]).stdout.split(" ")[0];
    const size = readFileSync(archive).byteLength;
    const manifest = join(root, "release.json");
    writeFileSync(manifest, JSON.stringify({
      sourceSha: releaseSha,
      sha256: checksum,
      size,
      builtAt: "2026-08-21T12:00:00Z",
      semver: "0.1.0",
      bundleId: "com.milad.imsg.desktop",
      artifactUrl: `file://${archive}`,
    }));

    const result = run(["/bin/bash", stager], undefined, {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      COMMA_RELEASE_URL: `file://${manifest}`,
      COMMA_ALLOW_INSECURE_URL: "1",
      COMMA_APP: app,
      COMMA_STAGER_LOCK: join(root, "stager.lock"),
      COMMA_STAGER_LOG: join(root, "stager.log"),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(sourceSha(app)).toBe(currentSha);
    expect(sourceSha(`${app}.staged`)).toBe(releaseSha);

    renameSync(app, `${app}.old`);
    renameSync(`${app}.staged`, app);
    renameSync(`${app}.old`, `${app}.staged`); // simulate power loss immediately after atomic exchange
    const afterActivation = run(["/bin/bash", stager], undefined, {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      COMMA_RELEASE_URL: `file://${manifest}`,
      COMMA_ALLOW_INSECURE_URL: "1",
      COMMA_APP: app,
      COMMA_STAGER_LOCK: join(root, "stager.lock"),
      COMMA_STAGER_LOG: join(root, "stager.log"),
    });
    expect(afterActivation.status, afterActivation.stderr).toBe(0);
    expect(await Bun.file(`${app}.staged`).exists()).toBe(false);
    expect(sourceSha(`${app}.previous`)).toBe(currentSha);
  });

  test("recovers an interrupted rollback bundle even after Mini current advances", () => {
    const root = scratch();
    const bin = makeFakeTools(root);
    const oldSha = "a".repeat(40);
    const installedSha = "b".repeat(40);
    const nextSha = "c".repeat(40);
    const app = join(root, "Comma.app");
    const sourceApp = join(root, "artifact/Comma.app");
    const archive = join(root, `Comma-${nextSha}.app.zip`);
    const manifest = join(root, "release.json");
    const activationState = join(root, "activation.json");
    makeApp(app, installedSha);
    makeApp(`${app}.staged`, oldSha);
    makeApp(sourceApp, nextSha);
    expect(run(["ditto", "-c", "-k", "--keepParent", sourceApp, archive]).status).toBe(0);
    writeFileSync(manifest, JSON.stringify({
      sourceSha: nextSha,
      sha256: run(["shasum", "-a", "256", archive]).stdout.split(" ")[0],
      size: readFileSync(archive).byteLength,
      builtAt: "2026-08-22T11:00:00Z",
      semver: "0.1.0",
      bundleId: "com.milad.imsg.desktop",
      artifactUrl: `file://${archive}`,
    }));
    writeFileSync(activationState, JSON.stringify({
      status: "activating",
      sourceSha: installedSha,
      previousSha: oldSha,
      detail: "app exited; bundle exchange starting",
      updatedAt: "2026-08-22T10:59:00Z",
    }));

    const result = run(["/bin/bash", stager], undefined, {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      COMMA_RELEASE_URL: `file://${manifest}`,
      COMMA_ALLOW_INSECURE_URL: "1",
      COMMA_APP: app,
      COMMA_STAGER_LOCK: join(root, "stager.lock"),
      COMMA_STAGER_LOG: join(root, "stager.log"),
      COMMA_ACTIVATION_STATE: activationState,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(sourceSha(app)).toBe(installedSha);
    expect(sourceSha(`${app}.previous`)).toBe(oldSha);
    expect(sourceSha(`${app}.staged`)).toBe(nextSha);

    const repeated = run(["/bin/bash", stager], undefined, {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      COMMA_RELEASE_URL: `file://${manifest}`,
      COMMA_ALLOW_INSECURE_URL: "1",
      COMMA_APP: app,
      COMMA_STAGER_LOCK: join(root, "stager.lock"),
      COMMA_STAGER_LOG: join(root, "stager.log"),
      COMMA_ACTIVATION_STATE: activationState,
    });
    expect(repeated.status, repeated.stderr).toBe(0);
    expect(sourceSha(`${app}.previous`)).toBe(oldSha);
    expect(sourceSha(`${app}.staged`)).toBe(nextSha);
  });

  test("recovers an interrupted automatic rollback and rejects the failed SHA", () => {
    const root = scratch();
    const bin = makeFakeTools(root);
    const oldSha = "d".repeat(40);
    const failedSha = "e".repeat(40);
    const app = join(root, "Comma.app");
    const failedApp = join(root, "artifact/Comma.app");
    const archive = join(root, `Comma-${failedSha}.app.zip`);
    const manifest = join(root, "release.json");
    const activationState = join(root, "activation.json");
    makeApp(app, oldSha);
    makeApp(`${app}.previous`, failedSha);
    makeApp(failedApp, failedSha);
    expect(run(["ditto", "-c", "-k", "--keepParent", failedApp, archive]).status).toBe(0);
    writeFileSync(manifest, JSON.stringify({
      sourceSha: failedSha,
      sha256: run(["shasum", "-a", "256", archive]).stdout.split(" ")[0],
      size: readFileSync(archive).byteLength,
      builtAt: "2026-08-22T11:30:00Z",
      semver: "0.1.0",
      bundleId: "com.milad.imsg.desktop",
      artifactUrl: `file://${archive}`,
    }));
    writeFileSync(activationState, JSON.stringify({
      status: "activating",
      sourceSha: failedSha,
      previousSha: oldSha,
      detail: "app exited; bundle exchange starting",
      updatedAt: "2026-08-22T11:29:00Z",
    }));

    const result = run(["/bin/bash", stager], undefined, {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      COMMA_RELEASE_URL: `file://${manifest}`,
      COMMA_ALLOW_INSECURE_URL: "1",
      COMMA_APP: app,
      COMMA_STAGER_LOCK: join(root, "stager.lock"),
      COMMA_STAGER_LOG: join(root, "stager.log"),
      COMMA_ACTIVATION_STATE: activationState,
      COMMA_NOTIFICATION_BIN: join(bin, "notify"),
      COMMA_NOTIFICATION_LOG: join(root, "notifications.log"),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(`${app}.previous`)).toBe(false);
    expect(existsSync(`${app}.staged`)).toBe(false);
    expect(JSON.parse(readFileSync(activationState, "utf8"))).toMatchObject({
      status: "rolled-back",
      sourceSha: failedSha,
      previousSha: oldSha,
    });
    expect(readFileSync(join(root, "notifications.log"), "utf8")).toContain("Comma update rolled back");
  });

  test("does not re-stage a rejected shell until the Mini current SHA advances", () => {
    const root = scratch();
    const bin = makeFakeTools(root);
    const currentSha = "7".repeat(40);
    const rejectedSha = "8".repeat(40);
    const nextSha = "9".repeat(40);
    const app = join(root, "Comma.app");
    const sourceApp = join(root, "artifact/Comma.app");
    const archive = join(root, `Comma-${rejectedSha}.app.zip`);
    const manifest = join(root, "release.json");
    const activationState = join(root, "activation.json");
    makeApp(app, currentSha);
    makeApp(sourceApp, rejectedSha);
    expect(run(["ditto", "-c", "-k", "--keepParent", sourceApp, archive]).status).toBe(0);
    writeFileSync(manifest, JSON.stringify({
      sourceSha: rejectedSha,
      sha256: run(["shasum", "-a", "256", archive]).stdout.split(" ")[0],
      size: readFileSync(archive).byteLength,
      builtAt: "2026-08-22T12:00:00Z",
      semver: "0.1.0",
      bundleId: "com.milad.imsg.desktop",
      artifactUrl: `file://${archive}`,
    }));
    writeFileSync(activationState, JSON.stringify({
      status: "rolled-back",
      sourceSha: rejectedSha,
      detail: "activation failed",
      updatedAt: "2026-08-22T12:01:00Z",
    }));

    const env = {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      COMMA_RELEASE_URL: `file://${manifest}`,
      COMMA_ALLOW_INSECURE_URL: "1",
      COMMA_APP: app,
      COMMA_STAGER_LOCK: join(root, "stager.lock"),
      COMMA_STAGER_LOG: join(root, "stager.log"),
      COMMA_ACTIVATION_STATE: activationState,
    };
    const rejected = run(["/bin/bash", stager], undefined, env);
    expect(rejected.status, rejected.stderr).toBe(0);
    expect(existsSync(`${app}.staged`)).toBe(false);
    expect(readFileSync(join(root, "stager.log"), "utf8")).toContain("refusing rejected Comma shell");

    rmSync(sourceApp, { recursive: true });
    makeApp(sourceApp, nextSha);
    const nextArchive = join(root, `Comma-${nextSha}.app.zip`);
    expect(run(["ditto", "-c", "-k", "--keepParent", sourceApp, nextArchive]).status).toBe(0);
    writeFileSync(manifest, JSON.stringify({
      sourceSha: nextSha,
      sha256: run(["shasum", "-a", "256", nextArchive]).stdout.split(" ")[0],
      size: readFileSync(nextArchive).byteLength,
      builtAt: "2026-08-22T12:02:00Z",
      semver: "0.1.0",
      bundleId: "com.milad.imsg.desktop",
      artifactUrl: `file://${nextArchive}`,
    }));
    const advanced = run(["/bin/bash", stager], undefined, env);
    expect(advanced.status, advanced.stderr).toBe(0);
    expect(sourceSha(`${app}.staged`)).toBe(nextSha);
  });
});

describe("detached desktop activation", () => {
  test("swaps after exit, retains the prior app, relaunches, and records activation", () => {
    const root = scratch();
    const bin = makeFakeTools(root);
    const oldSha = "3".repeat(40);
    const newSha = "4".repeat(40);
    const app = join(root, "Comma.app");
    makeApp(app, oldSha);
    makeApp(`${app}.staged`, newSha);

    const result = run(["/bin/bash", activator, "--app", app, "--expected-sha", newSha, "--wait-pid", "999999", "--ready-file", join(root, "ready")], undefined, {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      COMMA_OPEN_BIN: join(bin, "open"),
      COMMA_PROCESS_PROBE: join(bin, "process-running"),
      COMMA_ACTIVATION_LOG: join(root, "activation.log"),
      COMMA_ACTIVATION_STATE: join(root, "activation.json"),
      COMMA_LAUNCH_TIMEOUT_SECONDS: "1",
      COMMA_HEALTH_STABILIZATION_SECONDS: "0",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(sourceSha(app)).toBe(newSha);
    expect(sourceSha(`${app}.previous`)).toBe(oldSha);
    expect(JSON.parse(readFileSync(join(root, "activation.json"), "utf8"))).toMatchObject({
      status: "activated",
      sourceSha: newSha,
    });
  });

  test("rolls back and relaunches the prior app when the new process fails to appear", () => {
    const root = scratch();
    const bin = makeFakeTools(root);
    const oldSha = "5".repeat(40);
    const newSha = "6".repeat(40);
    const app = join(root, "Comma.app");
    makeApp(app, oldSha);
    makeApp(`${app}.staged`, newSha);
    const processOpen = join(bin, "process-open");
    const processProbe = join(bin, "process-fail-then-recover");
    writeFileSync(processOpen, `#!/bin/bash
count=0
[ ! -f "$COMMA_OPEN_COUNT_FILE" ] || count=$(cat "$COMMA_OPEN_COUNT_FILE")
count=$((count + 1))
printf '%s' "$count" >"$COMMA_OPEN_COUNT_FILE"
`);
    writeFileSync(processProbe, `#!/bin/bash
[ -f "$COMMA_OPEN_COUNT_FILE" ] || exit 0
count=$(cat "$COMMA_OPEN_COUNT_FILE")
[ "$count" -eq 1 ] && exit 0
printf '4242\\n'
`);
    chmodSync(processOpen, 0o755);
    chmodSync(processProbe, 0o755);

    const result = run(["/bin/bash", activator, "--app", app, "--expected-sha", newSha, "--wait-pid", "999999", "--ready-file", join(root, "ready")], undefined, {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      COMMA_OPEN_BIN: processOpen,
      COMMA_PROCESS_PROBE: processProbe,
      COMMA_OPEN_COUNT_FILE: join(root, "open-count"),
      COMMA_ACTIVATION_LOG: join(root, "activation.log"),
      COMMA_ACTIVATION_STATE: join(root, "activation.json"),
      COMMA_NOTIFICATION_BIN: join(bin, "notify"),
      COMMA_NOTIFICATION_LOG: join(root, "notifications.log"),
      COMMA_LAUNCH_TIMEOUT_SECONDS: "1",
      COMMA_HEALTH_STABILIZATION_SECONDS: "0",
    });

    expect(result.status).toBe(1);
    expect(sourceSha(app)).toBe(oldSha);
    expect(JSON.parse(readFileSync(join(root, "activation.json"), "utf8"))).toMatchObject({
      status: "rolled-back",
      sourceSha: newSha,
    });
    expect(readFileSync(join(root, "notifications.log"), "utf8")).toContain("Comma update rolled back");
  });
});

describe("desktop activation bootstrap", () => {
  test("activates the first staged shell without relying on installed Tauri commands", async () => {
    const root = scratch();
    const bin = makeFakeTools(root);
    const oldSha = "a".repeat(40);
    const newSha = "b".repeat(40);
    const app = join(root, "Comma.app");
    makeApp(app, oldSha);
    makeApp(`${app}.staged`, newSha);
    const fakeApp = Bun.spawn(["sleep", "30"]);
    const launchApp = join(bin, "bootstrap-open");
    const processProbe = join(bin, "bootstrap-process");
    const quitApp = join(bin, "bootstrap-quit");
    writeFileSync(launchApp, `#!/bin/bash
printf launched >"$COMMA_BOOTSTRAP_LAUNCH_MARKER"
`);
    writeFileSync(processProbe, `#!/bin/bash
if [ ! -f "$COMMA_BOOTSTRAP_QUIT_MARKER" ]; then
  printf '%s\\n' "$COMMA_FAKE_APP_PID"
elif [ -f "$COMMA_BOOTSTRAP_LAUNCH_MARKER" ]; then
  printf '4242\\n'
fi
`);
    writeFileSync(quitApp, `#!/bin/bash
kill "$COMMA_FAKE_APP_PID"
printf quit >"$COMMA_BOOTSTRAP_QUIT_MARKER"
`);
    chmodSync(launchApp, 0o755);
    chmodSync(processProbe, 0o755);
    chmodSync(quitApp, 0o755);

    const result = run(["/bin/bash", bootstrapActivator], undefined, {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      COMMA_APP: app,
      COMMA_OPEN_BIN: launchApp,
      COMMA_OSASCRIPT_BIN: quitApp,
      COMMA_PROCESS_PROBE: processProbe,
      COMMA_FAKE_APP_PID: String(fakeApp.pid),
      COMMA_BOOTSTRAP_QUIT_MARKER: join(root, "quit-marker"),
      COMMA_BOOTSTRAP_LAUNCH_MARKER: join(root, "launch-marker"),
      COMMA_ACTIVATION_LOG: join(root, "activation.log"),
      COMMA_ACTIVATION_STATE: join(root, "activation.json"),
      COMMA_BOOTSTRAP_READY_TIMEOUT_SECONDS: "3",
      COMMA_LAUNCH_TIMEOUT_SECONDS: "1",
      COMMA_HEALTH_STABILIZATION_SECONDS: "0",
    });

    expect(result.status, result.stderr).toBe(0);
    await fakeApp.exited;
    const activationState = join(root, "activation.json");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (existsSync(activationState)
        && JSON.parse(readFileSync(activationState, "utf8")).status === "activated") break;
      await Bun.sleep(20);
    }
    expect(sourceSha(app)).toBe(newSha);
    expect(JSON.parse(readFileSync(activationState, "utf8"))).toMatchObject({
      status: "activated",
      sourceSha: newSha,
    });
  });
});

describe("manual desktop rollback", () => {
  function makeProcessSequence(root: string): { open: string; probe: string } {
    const open = join(root, "bin/process-open");
    const probe = join(root, "bin/process-sequence");
    writeFileSync(open, `#!/bin/bash
count=0
[ ! -f "$COMMA_OPEN_COUNT_FILE" ] || count=$(cat "$COMMA_OPEN_COUNT_FILE")
count=$((count + 1))
printf '%s' "$count" >"$COMMA_OPEN_COUNT_FILE"
`);
    writeFileSync(probe, `#!/bin/bash
[ -f "$COMMA_OPEN_COUNT_FILE" ] || exit 0
count=$(cat "$COMMA_OPEN_COUNT_FILE")
if [ "$COMMA_PROCESS_SEQUENCE_MODE" = "restore" ] && [ "$count" -eq 1 ]; then exit 0; fi
printf '5252\\n'
`);
    chmodSync(open, 0o755);
    chmodSync(probe, 0o755);
    return { open, probe };
  }

  test("records the rejected SHA and verifies the rolled-back process", () => {
    const root = scratch();
    const bin = makeFakeTools(root);
    const processSequence = makeProcessSequence(root);
    const rejectedSha = "c".repeat(40);
    const previousSha = "d".repeat(40);
    const app = join(root, "Comma.app");
    makeApp(app, rejectedSha);
    makeApp(`${app}.previous`, previousSha);

    const result = run(["/bin/bash", rollback], undefined, {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      COMMA_APP: app,
      COMMA_OPEN_BIN: processSequence.open,
      COMMA_OSASCRIPT_BIN: join(bin, "osascript"),
      COMMA_PROCESS_PROBE: processSequence.probe,
      COMMA_OPEN_COUNT_FILE: join(root, "open-count"),
      COMMA_PROCESS_SEQUENCE_MODE: "success",
      COMMA_ACTIVATION_STATE: join(root, "activation.json"),
      COMMA_NOTIFICATION_BIN: join(bin, "notify"),
      COMMA_NOTIFICATION_LOG: join(root, "notifications.log"),
      COMMA_LAUNCH_TIMEOUT_SECONDS: "1",
      COMMA_HEALTH_STABILIZATION_SECONDS: "0",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(sourceSha(app)).toBe(previousSha);
    expect(sourceSha(`${app}.previous`)).toBe(rejectedSha);
    expect(JSON.parse(readFileSync(join(root, "activation.json"), "utf8"))).toMatchObject({
      status: "rolled-back",
      sourceSha: rejectedSha,
    });
    expect(readFileSync(join(root, "notifications.log"), "utf8")).toContain("Comma rolled back");
  });

  test("restores the original canonical app when the rollback process does not appear", () => {
    const root = scratch();
    const bin = makeFakeTools(root);
    const processSequence = makeProcessSequence(root);
    const rejectedSha = "e".repeat(40);
    const previousSha = "f".repeat(40);
    const app = join(root, "Comma.app");
    makeApp(app, rejectedSha);
    makeApp(`${app}.previous`, previousSha);

    const result = run(["/bin/bash", rollback], undefined, {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      COMMA_APP: app,
      COMMA_OPEN_BIN: processSequence.open,
      COMMA_OSASCRIPT_BIN: join(bin, "osascript"),
      COMMA_PROCESS_PROBE: processSequence.probe,
      COMMA_OPEN_COUNT_FILE: join(root, "open-count"),
      COMMA_PROCESS_SEQUENCE_MODE: "restore",
      COMMA_ACTIVATION_STATE: join(root, "activation.json"),
      COMMA_NOTIFICATION_BIN: join(bin, "notify"),
      COMMA_NOTIFICATION_LOG: join(root, "notifications.log"),
      COMMA_LAUNCH_TIMEOUT_SECONDS: "1",
      COMMA_HEALTH_STABILIZATION_SECONDS: "0",
    });

    expect(result.status).toBe(1);
    expect(sourceSha(app)).toBe(rejectedSha);
    expect(sourceSha(`${app}.previous`)).toBe(previousSha);
    expect(JSON.parse(readFileSync(join(root, "activation.json"), "utf8"))).toMatchObject({
      status: "rollback-failed",
      sourceSha: rejectedSha,
    });
    expect(readFileSync(join(root, "notifications.log"), "utf8")).toContain("prior Comma app was restored");
  });
});

describe("desktop deployment status", () => {
  test("reports the persisted activation result", () => {
    const root = scratch();
    const bin = makeFakeTools(root);
    const app = join(root, "Comma.app");
    const activationState = join(root, "activation.json");
    writeFileSync(join(bin, "curl"), `#!/bin/bash
for argument in "$@"; do
  case "$argument" in https://*) url="$argument" ;; esac
done
case "$url" in
  */api/health) printf '{"ok":true}' ;;
  */api/deploy/status) printf '{"environment":"production","webSha":"1111111111111111111111111111111111111111"}' ;;
  */api/desktop-release) printf '{"sourceSha":"2222222222222222222222222222222222222222"}' ;;
esac
`);
    chmodSync(join(bin, "curl"), 0o755);
    const installedSha = "3".repeat(40);
    const rejectedSha = "4".repeat(40);
    makeApp(app, installedSha);
    writeFileSync(activationState, JSON.stringify({
      status: "rolled-back",
      sourceSha: rejectedSha,
      detail: "new process did not remain healthy",
      updatedAt: "2026-08-22T14:00:00Z",
    }));

    const result = run(["/bin/bash", deployStatus], undefined, {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      IMSG_TAILNET_URL: "https://example.test",
      COMMA_APP: app,
      COMMA_ACTIVATION_STATE: activationState,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Shell activation: rolled-back / ${rejectedSha}`);
    expect(result.stdout).toContain("new process did not remain healthy");
  });
});

describe("desktop deployment lock", () => {
  test("does not let a contender take over while the owner file is being used", async () => {
    const root = scratch();
    const lock = join(root, "activation.lock");
    const harness = join(root, "lock-holder.sh");
    writeFileSync(harness, `#!/bin/bash
source "$1"
comma_acquire_lock "$2" comma:test || exit 3
printf ready >"$3"
sleep "$4"
comma_release_lock "$2" comma:test
`);
    const firstReady = join(root, "first-ready");
    const secondReady = join(root, "second-ready");
    const holder = Bun.spawn({
      cmd: ["/bin/zsh", "-c", "exec -a comma:test /bin/bash \"$@\"", "comma:test", harness, appVerifier, lock, firstReady, "2"],
      stdout: "pipe",
      stderr: "pipe",
    });
    for (let attempt = 0; attempt < 50 && !existsSync(firstReady); attempt += 1) {
      await Bun.sleep(20);
    }
    expect(existsSync(firstReady)).toBe(true);

    const contender = run(["/bin/zsh", "-c", "exec -a comma:test /bin/bash \"$@\"", "comma:test", harness, appVerifier, lock, secondReady, "0"]);
    expect(contender.status).toBe(3);
    expect(existsSync(secondReady)).toBe(false);
    expect(await holder.exited).toBe(0);
  });
});
