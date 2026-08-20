/** Hashed Expo web entry — changes on every production client build. */
const ENTRY_SRC = /\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/;

export function bundleStampFromHtml(html: string): string | null {
  return html.match(ENTRY_SRC)?.[0] ?? null;
}

export function currentBundleStamp(doc: Document): string | null {
  const scripts = Array.prototype.slice.call(doc.querySelectorAll("script[src]")) as Element[];
  for (let i = 0; i < scripts.length; i++) {
    const src = scripts[i]?.getAttribute("src") ?? "";
    const match = src.match(ENTRY_SRC);
    if (match) return match[0];
  }
  return null;
}

export function shouldReloadForDeploy(current: string | null, incoming: string | null): boolean {
  return current !== null && incoming !== null && current !== incoming;
}

export function composerIsBusy(doc: Document): boolean {
  const el = doc.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.getAttribute("contenteditable") === "true";
}

export interface DeployReloadHost {
  readonly document: Document;
  fetchHtml: () => Promise<string>;
  reload: () => void;
  nowBusy?: () => boolean;
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 45_000;

/**
 * When the Mini deploys a new web export, reload the page (Tauri or PWA)
 * so the running window isn't stuck on a cached bundle. Skips while the
 * composer/search field is focused so a half-typed message isn't wiped.
 */
export function installDeployReloader(host: DeployReloadHost): () => void {
  const intervalMs = host.intervalMs ?? DEFAULT_INTERVAL_MS;
  let cancelled = false;
  let inFlight = false;

  const check = (): void => {
    if (cancelled || inFlight) return;
    if ((host.nowBusy ?? (() => composerIsBusy(host.document)))()) return;
    const current = currentBundleStamp(host.document);
    if (!current) return;
    inFlight = true;
    void host
      .fetchHtml()
      .then((html) => {
        if (cancelled) return;
        if (shouldReloadForDeploy(current, bundleStampFromHtml(html))) host.reload();
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
      });
  };

  const onVisible = (): void => {
    if (host.document.visibilityState === "visible") check();
  };

  host.document.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(check, intervalMs);
  check();

  return () => {
    cancelled = true;
    host.document.removeEventListener("visibilitychange", onVisible);
    clearInterval(timer);
  };
}
