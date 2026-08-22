import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BranchIdentity } from "./branch-core";
import { IMSG_ROOT, run, writeJson } from "./runtime";

export interface DesktopConfigArtifact {
  readonly directory: string;
  readonly configPath: string;
  readonly iconSourcePath: string;
  readonly iconDirectory: string;
}

export async function prepareDesktopConfig(
  identity: BranchIdentity,
  previewUrl: string,
  options: { readonly dryRun: boolean; readonly iconSource?: string | null },
): Promise<DesktopConfigArtifact> {
  const directory = resolve(IMSG_ROOT, `.cache/comma-deploy/desktop-${identity.instanceHash}`);
  const configPath = resolve(directory, "tauri.dev.conf.json");
  const iconSourcePath = resolve(directory, "comma-dev.svg");
  const iconDirectory = resolve(directory, "icons");
  const suppliedIcon = options.iconSource ?? Bun.env.COMMA_DEV_ICON_SOURCE ?? null;

  if (!options.dryRun) {
    await mkdir(directory, { recursive: true });
    if (suppliedIcon) {
      await writeFile(iconSourcePath, await readFile(suppliedIcon));
    } else {
      await writeFile(iconSourcePath, createDevIconSvg());
    }
    await run(
      ["bunx", "tauri", "icon", "--output", iconDirectory, iconSourcePath],
      { cwd: resolve(IMSG_ROOT, "desktop") },
    );
    await writeJson(configPath, tauriConfig(identity, previewUrl, iconDirectory));
  } else {
    console.log(`Would generate DEV-badged icon: ${suppliedIcon ?? iconSourcePath}`);
    console.log(`Would write Tauri override: ${configPath}`);
  }

  return { directory, configPath, iconSourcePath, iconDirectory };
}

const PREVIEW_IPC_PERMISSIONS = [
  "core:default",
  "core:event:default",
  "core:window:allow-close",
  "core:window:allow-start-dragging",
  "core:window:allow-minimize",
  "core:window:allow-toggle-maximize",
  "opener:default",
] as const;

export function tauriConfig(identity: BranchIdentity, previewUrl: string, iconDirectory: string): object {
  return {
    productName: identity.appName,
    identifier: identity.bundleId,
    build: {
      devUrl: previewUrl,
      frontendDist: previewUrl,
    },
    app: {
      security: {
        capabilities: [
          "default",
          {
            identifier: `comma-preview-${identity.branchHash}`,
            description: `Comma Dev IPC for ${identity.branch}`,
            windows: ["main"],
            local: false,
            remote: { urls: [previewUrl, `${previewUrl}/**`] },
            permissions: [...PREVIEW_IPC_PERMISSIONS],
          },
        ],
      },
      windows: [{
        label: "main",
        create: false,
        title: identity.windowTitle,
        width: 1280,
        height: 860,
        minWidth: 900,
        minHeight: 600,
        decorations: true,
        hiddenTitle: true,
        titleBarStyle: "Overlay",
        trafficLightPosition: { x: 14, y: 14 },
        transparent: false,
        shadow: true,
      }],
    },
    bundle: {
      icon: [
        resolve(iconDirectory, "32x32.png"),
        resolve(iconDirectory, "128x128.png"),
        resolve(iconDirectory, "128x128@2x.png"),
        resolve(iconDirectory, "icon.icns"),
        resolve(iconDirectory, "icon.ico"),
      ],
    },
  };
}

function createDevIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#24242a"/><stop offset="1" stop-color="#08080a"/></linearGradient></defs>
  <rect width="1024" height="1024" rx="220" fill="url(#bg)"/>
  <path d="M275 260h474v410H430L275 790V260Z" fill="#fff"/>
  <circle cx="407" cy="465" r="42" fill="#111"/><circle cx="512" cy="465" r="42" fill="#111"/><circle cx="617" cy="465" r="42" fill="#111"/>
  <rect x="495" y="720" width="480" height="220" rx="76" fill="#ff9f0a" stroke="#fff" stroke-width="18"/>
  <text x="735" y="865" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="132" font-weight="900" fill="#111">DEV</text>
</svg>\n`;
}
