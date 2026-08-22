export const RELEASE_ENVIRONMENTS = ["production", "preview", "development", "fixture"] as const;

export type ReleaseEnvironment = (typeof RELEASE_ENVIRONMENTS)[number];

export interface ClientReleaseBuild {
  readonly environment: ReleaseEnvironment;
  readonly branch: string | null;
  readonly webSha: string | null;
}

export interface DeployedWebRelease {
  readonly environment: ReleaseEnvironment;
  readonly branch: string | null;
  readonly webSha: string;
}

export interface ShellReleaseState {
  readonly runningSha: string | null;
  readonly stagedSha: string | null;
}

export interface ReleaseIdentitySnapshot {
  readonly running: ClientReleaseBuild;
  readonly deployedWeb: DeployedWebRelease | null;
  readonly shell: ShellReleaseState;
}

const SHA_PATTERN = /^[a-f0-9]{7,64}$/i;

export function releaseSha(value: string | null | undefined): string | null {
  const sha = value?.trim() ?? "";
  return SHA_PATTERN.test(sha) ? sha.toLowerCase() : null;
}

export function releaseEnvironment(value: string | null | undefined): ReleaseEnvironment | null {
  const environment = value?.trim();
  return RELEASE_ENVIRONMENTS.find((candidate) => candidate === environment) ?? null;
}

export function releaseBranch(value: string | null | undefined): string | null {
  const branch = value?.trim() ?? "";
  return branch.length > 0 ? branch : null;
}

export function parseDeployedWebRelease(
  value: Readonly<Record<string, string | null | undefined>>,
): DeployedWebRelease | null {
  const environment = releaseEnvironment(value.environment);
  const webSha = releaseSha(value.webSha);
  if (!environment || !webSha) return null;
  return {
    environment,
    branch: releaseBranch(value.branch),
    webSha,
  };
}

export function parseShellReleaseState(
  value: Readonly<Record<string, string | null | undefined>>,
): ShellReleaseState | null {
  const runningSha = releaseSha(value.runningSha);
  const stagedSha = releaseSha(value.stagedSha);
  if (value.runningSha && !runningSha) return null;
  if (value.stagedSha && !stagedSha) return null;
  return { runningSha, stagedSha };
}

export function webUpdateAvailable(snapshot: ReleaseIdentitySnapshot): boolean {
  const deployed = snapshot.deployedWeb;
  const runningSha = snapshot.running.webSha;
  if (!deployed || !runningSha) return false;
  return deployed.environment === snapshot.running.environment
    && deployed.branch === snapshot.running.branch
    && deployed.webSha !== runningSha;
}

export function shellUpdateAvailable(snapshot: ReleaseIdentitySnapshot): boolean {
  return snapshot.shell.stagedSha !== null
    && snapshot.shell.stagedSha !== snapshot.shell.runningSha;
}

export function displayReleaseSha(sha: string | null): string {
  return sha?.slice(0, 12) ?? "—";
}
