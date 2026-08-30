export function nestedSheetDelay(platform: string): number {
  return platform === "ios" ? 300 : 0;
}
