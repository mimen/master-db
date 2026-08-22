import { resolve } from "node:path";
import { DEFAULT_PRODUCTION_URL } from "./deployment/branch-core";
import { prepareDesktopConfig } from "./deployment/desktop-config";
import { currentGitIdentity, flagValue, hasFlag, IMSG_ROOT, shellQuote } from "./deployment/runtime";

const dryRun = hasFlag("--dry-run");
const identity = await currentGitIdentity(false);
const previewUrl = flagValue("--url") ?? Bun.env.COMMA_PREVIEW_URL ?? DEFAULT_PRODUCTION_URL;
const config = await prepareDesktopConfig(identity, previewUrl, {
  dryRun,
  iconSource: flagValue("--icon"),
});
const processIdentity = `comma:desktop-dev@${identity.processRef}`;

console.log(JSON.stringify({
  branch: identity.branch,
  sha: identity.sha,
  worktree: identity.worktree,
  appName: identity.appName,
  bundleId: identity.bundleId,
  title: identity.windowTitle,
  processIdentity,
  guard: "COMMA_DEV_GUARDED=1",
  previewUrl,
  configPath: config.configPath,
}, null, 2));

const command = `exec -a ${shellQuote(processIdentity)} bunx tauri dev --config ${shellQuote(config.configPath)}`;
if (dryRun) {
  console.log(`$ (cd ${resolve(IMSG_ROOT, "desktop")} && zsh -lc ${shellQuote(command)})`);
  process.exit(0);
}

const env = { ...process.env };
delete env.PROCID;
delete env.PROCID_REF;
delete env.PROCID_OFF;
env.PROCID = processIdentity;
env.COMMA_DEV_GUARDED = "1";
const child = Bun.spawn(["zsh", "-lc", command], {
  cwd: resolve(IMSG_ROOT, "desktop"),
  env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await child.exited);
