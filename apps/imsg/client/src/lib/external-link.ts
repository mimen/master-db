import { Linking } from "react-native";
import { openUrlViaShell } from "./desktop-shell";

/**
 * Open an http(s) URL outside the app. In the Tauri desktop shell,
 * `Linking.openURL` bottoms out in a `window.open` the WebView swallows, so
 * external links must route through the shell's opener first.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (await openUrlViaShell(url)) return;
  await Linking.openURL(url);
}
