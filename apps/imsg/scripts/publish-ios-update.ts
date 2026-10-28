import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface IosBuild {
  readonly id: string;
  readonly status: string;
  readonly fingerprint?: { readonly hash: string } | null;
}

export type IosReleasePlan =
  | { readonly kind: "publish" }
  | { readonly kind: "wait"; readonly buildId: string }
  | { readonly kind: "build" };

const IN_FLIGHT = new Set(["NEW", "IN_QUEUE", "IN_PROGRESS", "PENDING"]);

/**
 * An OTA reaches only installs whose native runtime matches, so it publishes when a finished
 * build carries this fingerprint. Otherwise a new build is needed, and its install link is the
 * one moment the phone needs a human.
 */
export function planIosRelease(fingerprint: string, builds: readonly IosBuild[]): IosReleasePlan {
  const matching = builds.filter((build) => build.fingerprint?.hash === fingerprint);
  if (matching.some((build) => build.status === "FINISHED")) return { kind: "publish" };
  const inFlight = matching.find((build) => IN_FLIGHT.has(build.status));
  return inFlight ? { kind: "wait", buildId: inFlight.id } : { kind: "build" };
}

const PROFILE = "production";

function eas(args: readonly string[], env: Record<string, string>): string {
  const result = Bun.spawnSync(["bunx", "eas-cli", ...args, "--non-interactive"], {
    cwd: join(import.meta.dir, "../client"),
    env: { ...process.env, ...env },
  });
  if (result.exitCode !== 0) {
    throw new Error(`eas ${args[0]} failed: ${result.stderr.toString().trim()}\n${result.stdout.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

function main(sourceSha: string): void {
  const token = process.env.EXPO_TOKEN ?? readFileSync(join(homedir(), ".config/comma/expo-token"), "utf8").trim();
  const easJson = JSON.parse(readFileSync(join(import.meta.dir, "../client/eas.json"), "utf8")) as {
    build: Record<string, { env: Record<string, string> }>;
  };
  const env = {
    ...easJson.build[PROFILE]?.env,
    EXPO_TOKEN: token,
    EXPO_PUBLIC_IMSG_RELEASE_BRANCH: "",
    EXPO_PUBLIC_IMSG_WEB_SHA: sourceSha,
  };
  const { hash } = JSON.parse(
    eas(["fingerprint:generate", "--build-profile", PROFILE, "--platform", "ios", "--json"], env),
  ) as { hash: string };
  const builds = JSON.parse(
    eas(["build:list", "--platform", "ios", "--build-profile", PROFILE, "--limit", "10", "--json"], env),
  ) as IosBuild[];
  const plan = planIosRelease(hash, builds);

  if (plan.kind === "publish") {
    // eas update exports to client/dist by default, which is the live web release the Mini serves.
    eas(["update", "--channel", PROFILE, "--environment", PROFILE, "--platform", "ios", "--input-dir", "dist-ios-update", "--message", sourceSha.slice(0, 7)], env);
    console.log(`iOS OTA published for ${sourceSha.slice(0, 7)} on runtime ${hash.slice(0, 12)}`);
    return;
  }
  if (plan.kind === "wait") {
    console.log(`iOS build ${plan.buildId} for runtime ${hash.slice(0, 12)} is still running; the next deploy publishes OTA`);
    return;
  }
  const started = JSON.parse(
    eas(["build", "--platform", "ios", "--profile", PROFILE, "--no-wait", "--json"], env),
  ) as { id: string }[];
  console.log(
    `Native runtime changed. Install the new iOS build when it finishes: https://expo.dev/accounts/mimen1994/projects/imsg/builds/${started[0]?.id}`,
  );
}

if (import.meta.main) {
  const sha = process.argv[2] ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("usage: publish-ios-update.ts <full source sha>");
  main(sha);
}
