import { Platform } from "react-native";

/**
 * Server base URL. On web the app is served by the imsg server itself, so
 * relative URLs work; native reaches the Mini over the tailnet.
 */
export const BASE_URL = Platform.OS === "web" ? "" : "http://milads-mac-mini:8377";
