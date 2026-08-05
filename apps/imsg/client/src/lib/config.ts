import { Platform } from "react-native";

/**
 * Server base URL. On web the app is served by the imsg server itself, so
 * relative URLs work; native reaches the Mini over the tailnet.
 */
export const BASE_URL =
  Platform.OS === "web" ? "" : "https://milads-mac-mini.taild31e9a.ts.net:8447";
