/**
 * The Convex socket upgrade takes 200 to 330 ms, and the token request needs the bundle
 * first. index.html starts both before the bundle downloads (scripts/post-export.ts), and
 * the client takes each over exactly once.
 */
export type BootHandoff = { socket?: WebSocket; token?: Promise<Response> };

const GLOBAL = "__commaBoot";

function handoff(): BootHandoff {
  return (globalThis as { [GLOBAL]?: BootHandoff })[GLOBAL] ?? {};
}

/** Inline script for index.html. `socketUrl` must equal the URL the Convex client opens. */
export function bootScript(socketUrl: string): string {
  return `(function(){var b=window.${GLOBAL}={};try{b.socket=new WebSocket(${JSON.stringify(socketUrl)})}catch(e){}` +
    `b.token=fetch("/api/convex-token");b.token.catch(function(){})})()`;
}

export function convexSocketUrl(convexUrl: string, sdkVersion: string): string {
  return `${convexUrl.replace(/^http/, "ws")}/api/${sdkVersion}/sync`;
}

export function takeBootToken(boot: BootHandoff = handoff()): Promise<Response> | undefined {
  const token = boot.token;
  boot.token = undefined;
  return token;
}

/** A WebSocket constructor for the Convex client that returns the boot socket for its URL once. */
export function bootWebSocket(boot: BootHandoff = handoff(), Socket: typeof WebSocket = WebSocket): typeof WebSocket {
  function BootWebSocket(url: string | URL, protocols?: string | string[]): WebSocket {
    const early = boot.socket;
    boot.socket = undefined;
    if (early && early.url === String(url) && early.readyState <= Socket.OPEN) {
      // The client attaches onopen after construction, so an open that already fired is replayed.
      if (early.readyState === Socket.OPEN) {
        setTimeout(() => { if (early.readyState === Socket.OPEN) early.dispatchEvent(new Event("open")); });
      }
      return early;
    }
    early?.close();
    return new Socket(url, protocols);
  }
  return BootWebSocket as unknown as typeof WebSocket;
}
